package ru.vsm.trainer;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowInsets;
import android.webkit.HttpAuthHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.nio.file.Files;

/** Stand wrapper. No JavaScript/native bridge, file access, camera or microphone permissions. */
public final class MainActivity extends Activity {
    private WebView web;
    private TextView status;
    private boolean provisionAttempted;
    private final String host = Uri.parse(BuildConfig.STAND_URL).getHost();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.addView(button("Смена", "/"), new LinearLayout.LayoutParams(0, -2, 1));
        toolbar.addView(button("Тест модели", "/bench"), new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(toolbar);
        status = new TextView(this);
        status.setTextColor(Color.BLACK);
        status.setText("Загрузка защищённого стенда…");
        root.addView(status);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                status.setText("Учебный стенд · " + host);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) status.setText("Нет соединения. Проверьте интернет и нажмите «Смена» повторно.");
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String authHost, String realm) {
                if (!host.equalsIgnoreCase(authHost)) { handler.cancel(); return; }
                if (BuildConfig.DEBUG && !provisionAttempted) {
                    provisionAttempted = true;
                    try {
                        JSONObject access = new JSONObject(new String(Files.readAllBytes(new java.io.File(getFilesDir(), "stand-access.json").toPath()), java.nio.charset.StandardCharsets.UTF_8));
                        if (BuildConfig.STAND_URL.equals(access.getString("baseUrl"))) {
                            handler.proceed(access.getString("username"), access.getString("password"));
                            return;
                        }
                    } catch (Exception ignored) { /* Manual login remains available. No secret logging. */ }
                }
                LinearLayout fields = new LinearLayout(MainActivity.this);
                fields.setOrientation(LinearLayout.VERTICAL);
                EditText username = new EditText(MainActivity.this);
                username.setHint("Логин"); username.setText("trainer"); fields.addView(username);
                EditText password = new EditText(MainActivity.this);
                password.setHint("Пароль стенда");
                password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                fields.addView(password);
                new AlertDialog.Builder(MainActivity.this).setTitle("Доступ к учебному стенду")
                    .setView(fields).setPositiveButton("Войти", (dialog, which) -> handler.proceed(username.getText().toString(), password.getText().toString()))
                    .setNegativeButton("Отмена", (dialog, which) -> handler.cancel())
                    .setOnCancelListener(dialog -> handler.cancel()).show();
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (state == null || web.restoreState(state) == null) web.loadUrl(BuildConfig.STAND_URL + "/");
    }

    private boolean allowed(Uri uri) {
        return "https".equals(uri.getScheme()) && host.equalsIgnoreCase(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private Button button(String label, String path) {
        Button button = new Button(this);
        button.setText(label); button.setTextColor(Color.BLACK);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE); background.setStroke(1, Color.BLACK); background.setCornerRadius(0);
        button.setBackground(background);
        button.setOnClickListener(view -> { provisionAttempted = false; web.loadUrl(BuildConfig.STAND_URL + path); });
        return button;
    }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
