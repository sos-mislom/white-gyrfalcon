package ru.vsm.trainer;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;

/** Stand wrapper with a narrow on-device speech bridge. */
public final class MainActivity extends Activity {
    private WebView web;
    private NativeVoice nativeVoice;
    private boolean shellRefreshStarted;
    private final String host = Uri.parse(BuildConfig.STAND_URL).getHost();
    private final String entryUrl = BuildConfig.STAND_URL + "/play";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(18, 13, 22));
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        nativeVoice = new NativeVoice(this, web);
        web.addJavascriptInterface(nativeVoice, "VsmVoice");
        web.addJavascriptInterface(new DeviceIdentity(this), "VsmDevice");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                nativeVoice.setCurrentUrl(url);
                view.evaluateJavascript("window.dispatchEvent(new Event('vsm-voice-ready'))", null);
                if (!shellRefreshStarted && allowed(Uri.parse(url))) {
                    shellRefreshStarted = true;
                    // An older service worker can serve the previous HTML on the first launch
                    // after an update. Reload once its replacement is active and cached.
                    view.evaluateJavascript("(async()=>{if(!navigator.serviceWorker||!window.caches)return;" +
                        "let refreshed=false;const check=async()=>{if(refreshed)return;" +
                        "const names=(await caches.keys()).filter(n=>n.startsWith('vsm-shell-'));" +
                        "if(!names.length)return;const cache=await caches.open(names[names.length-1]);" +
                        "const scripts=[...document.scripts].map(s=>s.src).filter(s=>s.includes('/_next/static/'));" +
                        "if(!scripts.length)return;const hits=await Promise.all(scripts.map(s=>cache.match(s)));" +
                        "if(hits.some(hit=>!hit)){refreshed=true;location.reload()}};" +
                        "navigator.serviceWorker.addEventListener('controllerchange',check,{once:true});" +
                        "const update=async()=>{try{const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});" +
                        "await registration.update();await check()}catch{}};" +
                        "void update();setTimeout(update,5000);setTimeout(update,15000)})().catch(()=>{})", null);
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) new AlertDialog.Builder(MainActivity.this)
                    .setMessage("Нет соединения со стендом.")
                    .setPositiveButton("Повторить", (dialog, which) -> web.loadUrl(entryUrl))
                    .setNegativeButton("Закрыть", (dialog, which) -> dialog.dismiss()).show();
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String authHost, String realm) {
                handler.cancel();
                if (host.equalsIgnoreCase(authHost)) new AlertDialog.Builder(MainActivity.this)
                    .setMessage("Доступ приложения не подтверждён. Установите актуальную версию.")
                    .setPositiveButton("Понятно", (dialog, which) -> dialog.dismiss()).show();
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (BuildConfig.MOBILE_ACCESS_TOKEN.isEmpty()) web.loadUrl(entryUrl);
        else {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setCookie(BuildConfig.STAND_URL,
                "vsm_mobile=" + BuildConfig.MOBILE_ACCESS_TOKEN + "; Secure; HttpOnly; SameSite=Strict; Path=/",
                accepted -> {
                    if (accepted) { cookies.flush(); web.loadUrl(entryUrl); }
                    else new AlertDialog.Builder(MainActivity.this)
                        .setMessage("Не удалось открыть учебный стенд. Повторите запуск приложения.")
                        .setPositiveButton("Понятно", (dialog, which) -> dialog.dismiss()).show();
                });
        }
    }

    private boolean allowed(Uri uri) {
        Uri base = Uri.parse(BuildConfig.STAND_URL);
        return base.getScheme().equals(uri.getScheme()) && host.equalsIgnoreCase(uri.getHost()) &&
            (uri.getPort() == base.getPort() || (base.getPort() == -1 && uri.getPort() == 443));
    }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        nativeVoice.onPermissionResult(requestCode, grantResults);
    }
    @Override protected void onPause() {
        nativeVoice.pause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('vsm-voice-interrupted'))", null);
    }
    @Override protected void onDestroy() { nativeVoice.destroy(); web.destroy(); super.onDestroy(); }
}
