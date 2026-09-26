package ru.vsm.trainer;

import android.content.Context;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/** Pseudonymous, app-scoped device identity; raw ANDROID_ID never enters the WebView. */
public final class DeviceIdentity {
    private final Context context;
    DeviceIdentity(Context context) { this.context = context.getApplicationContext(); }

    @JavascriptInterface public String getId() {
        String source = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (source == null || source.isEmpty() || "9774d56d682e549c".equals(source)) {
            var prefs = context.getSharedPreferences("device-profile", Context.MODE_PRIVATE);
            source = prefs.getString("fallback", null);
            if (source == null) {
                byte[] random = new byte[32];
                new SecureRandom().nextBytes(random);
                source = hex(random);
                prefs.edit().putString("fallback", source).apply();
            }
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                (context.getPackageName() + ":" + source).getBytes(StandardCharsets.UTF_8));
            return hex(digest);
        } catch (Exception e) { throw new IllegalStateException("Device identity unavailable", e); }
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        return value.toString();
    }
}
