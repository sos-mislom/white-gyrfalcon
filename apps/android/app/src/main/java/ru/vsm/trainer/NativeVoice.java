package ru.vsm.trainer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.Locale;

/** Narrow bridge: offline Android speech only, limited to the pinned stand origin. */
public final class NativeVoice {
    private final Activity activity;
    private final WebView web;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private volatile String currentUrl;
    private boolean listening;
    private boolean listeningRequested;
    private boolean speaking;
    private String currentSpeechId;
    private int permissionRequestCode = 7304;

    NativeVoice(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        tts = new TextToSpeech(activity, status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) return;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { Log.i("VsmVoice", "tts_start"); }
                @Override public void onDone(String utteranceId) { Log.i("VsmVoice", "tts_done"); resumeRecognition(utteranceId); }
                @Override public void onError(String utteranceId) { Log.w("VsmVoice", "tts_error"); resumeRecognition(utteranceId); }
            });
            Voice selected = null;
            if (tts.getVoices() == null) return;
            for (Voice voice : tts.getVoices()) {
                if (!russianOffline(voice)) continue;
                if (selected == null || voiceScore(voice, "female") > voiceScore(selected, "female")) selected = voice;
            }
            if (selected != null) {
                ttsReady = tts.setVoice(selected) == TextToSpeech.SUCCESS;
                Log.i("VsmVoice", "tts_ready=" + ttsReady + " voice=" + selected.getName());
                if (ttsReady) activity.runOnUiThread(() -> web.evaluateJavascript(
                    "window.dispatchEvent(new Event('vsm-voice-ready'))", null));
            }
        });
    }

    private boolean trusted() {
        String url = currentUrl;
        return url != null && (url.equals(BuildConfig.STAND_URL + "/") ||
            url.startsWith(BuildConfig.STAND_URL + "/"));
    }

    void setCurrentUrl(String url) { currentUrl = url; }

    @JavascriptInterface public boolean canRecognize() {
        return trusted() && Build.VERSION.SDK_INT >= 31 &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(activity);
    }

    @JavascriptInterface public boolean canSpeak() {
        return trusted() && ttsReady;
    }

    @JavascriptInterface public void speak(String text) {
        speakVoice(text, "neutral");
    }

    @JavascriptInterface public void speakVoice(String text, String gender) {
        if (!trusted() || text == null) return;
        String speech = text.trim();
        if (speech.isEmpty() || speech.length() > 500) return;
        activity.runOnUiThread(() -> {
            if (!ttsReady || tts == null) return;
            String target = "female".equals(gender) ? "female" : "male".equals(gender) ? "male" : "female";
            Voice selected = null;
            if (tts.getVoices() != null) {
                for (Voice voice : tts.getVoices()) {
                    if (!russianOffline(voice)) continue;
                    if (selected == null || voiceScore(voice, target) > voiceScore(selected, target)) selected = voice;
                }
            }
            if (selected != null) {
                int selectedStatus = tts.setVoice(selected);
                Log.i("VsmVoice", "tts_gender=" + target + " voice=" + selected.getName() + " selected=" + (selectedStatus == TextToSpeech.SUCCESS));
            }
            // A pitch shift cannot turn a male voice into a female one.
            tts.setPitch(1.0f);
            speaking = true;
            currentSpeechId = "passenger-" + System.nanoTime();
            if (listening && recognizer != null) {
                listening = false;
                recognizer.cancel();
            }
            if (tts.speak(speech, TextToSpeech.QUEUE_FLUSH, null, currentSpeechId) != TextToSpeech.SUCCESS) {
                Log.w("VsmVoice", "tts_queue_error");
                resumeRecognition(currentSpeechId);
            }
        });
    }

    private static boolean russianOffline(Voice voice) {
        return "ru".equals(voice.getLocale().getLanguage()) && !voice.isNetworkConnectionRequired();
    }

    private static int voiceScore(Voice voice, String gender) {
        String name = voice.getName().toLowerCase(Locale.ROOT);
        boolean female = name.contains("female") || name.contains("svetlana") || name.contains("alena") ||
            name.contains("elena") || name.contains("irina") || name.contains("anna") ||
            name.contains("tatiana") || name.contains("tatyana") || name.contains("milena") ||
            name.contains("-dfc-") || name.contains("-ruc-") || name.contains("-rue-");
        boolean male = (name.contains("male") && !name.contains("female")) || name.contains("dmitry") ||
            name.contains("pavel") || name.contains("maxim") || name.contains("-rud-") || name.contains("-ruf-");
        int score = "RU".equals(voice.getLocale().getCountry()) ? 1 : 0;
        if ("female".equals(gender)) score += female ? 100 : male ? -100 : 0;
        else score += male ? 100 : female ? -100 : 0;
        return score + voice.getQuality() / 100;
    }

    private void resumeRecognition(String utteranceId) {
        activity.runOnUiThread(() -> {
            if (!utteranceId.equals(currentSpeechId)) return;
            currentSpeechId = null;
            speaking = false;
            if (listeningRequested) web.postDelayed(() -> {
                if (listeningRequested && !speaking) begin();
            }, 500);
        });
    }

    @JavascriptInterface public void stopSpeech() {
        if (!trusted()) return;
        activity.runOnUiThread(() -> { currentSpeechId = null; speaking = false; if (tts != null) tts.stop(); });
    }

    @JavascriptInterface public void startListening() {
        if (!canRecognize()) { emit("", true, "local_recognition_unavailable"); return; }
        activity.runOnUiThread(() -> {
            listeningRequested = true;
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, permissionRequestCode);
                return;
            }
            if (speaking) return;
            begin();
        });
    }

    void onPermissionResult(int requestCode, int[] grants) {
        if (requestCode != permissionRequestCode) return;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) begin();
        else emit("", true, "microphone_permission_denied");
    }

    @android.annotation.TargetApi(31)
    private void begin() {
        if (listening || speaking || !listeningRequested) return;
        listening = true;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    Log.i("VsmVoice", "asr_ready");
                    emit("", false, "recognition_ready");
                }
                @Override public void onBeginningOfSpeech() {
                    Log.i("VsmVoice", "asr_speech_started");
                    if (tts != null) tts.stop();
                    emit("", false, "speech_started");
                }
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { Log.i("VsmVoice", "asr_speech_ended"); }
                @Override public void onError(int error) {
                    Log.i("VsmVoice", "asr_error=" + error);
                    listening = false;
                    if (speaking || !listeningRequested) return;
                    emit("", true, "recognition_error_" + error);
                }
                @Override public void onResults(Bundle results) {
                    Log.i("VsmVoice", "asr_final_chars=" + best(results).length());
                    listening = false;
                    if (speaking || !listeningRequested) return;
                    emit(best(results), true, "");
                }
                @Override public void onPartialResults(Bundle results) {
                    if (speaking || !listeningRequested) return;
                    Log.d("VsmVoice", "asr_partial_chars=" + best(results).length());
                    emit(best(results), false, "");
                }
                @Override public void onEvent(int eventType, Bundle params) {}
            });
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        if (Build.VERSION.SDK_INT >= 33) {
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
            intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS,
                new ArrayList<>(java.util.Arrays.asList("проводник", "вагон", "билет", "место", "поезд",
                    "РЖД", "Москва", "Санкт-Петербург", "ВСМ")));
        }
        recognizer.startListening(intent);
    }

    private static String best(Bundle results) {
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return matches == null || matches.isEmpty() ? "" : matches.get(0);
    }

    private void emit(String text, boolean done, String error) {
        String payload = org.json.JSONObject.quote(text.length() > 500 ? text.substring(0, 500) : text);
        String problem = org.json.JSONObject.quote(error);
        activity.runOnUiThread(() -> {
            if (trusted()) web.evaluateJavascript(
                "window.__vsmNativeSpeech?.(" + payload + "," + done + "," + problem + ")", null);
        });
    }

    @JavascriptInterface public void stopListening() {
        if (!trusted()) return;
        activity.runOnUiThread(() -> {
            listeningRequested = false;
            listening = false;
            if (recognizer != null) recognizer.cancel();
        });
    }

    void destroy() {
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
    }
}
