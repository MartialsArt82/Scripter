package de.scripter.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public final class MainActivity extends Activity {
    private static final String HOST = "scripter.app";
    private static final String ORIGIN = "https://" + HOST;
    private final ExecutorService documents = Executors.newSingleThreadExecutor();
    private WebView web;
    private WebView printView;
    private FrameLayout page;
    private ProjectFiles files;
    private SQLiteDatabase thesaurus;
    private Request pending;
    private volatile String activeProject = "";

    private static final class Request {
        final int id;
        final String operation;
        final JSONObject data;

        Request(int id, String operation, JSONObject data) {
            this.id = id;
            this.operation = operation;
            this.data = data;
        }
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        files = new ProjectFiles(this);
        page = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            page.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets padding = insets.getInsets(WindowInsets.Type.systemBars() |
                    WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
                return insets;
            });
        }
        page.setBackgroundColor(0xff26362b);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.addJavascriptInterface(new Bridge(), "ScripterAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return resource(request);
            }
        });
        page.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(page);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private WebResourceResponse resource(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"GET".equals(request.getMethod()) || !"https".equals(url.getScheme()) || !HOST.equals(url.getHost()))
            return missing();
        String path = url.getPath();
        if (path == null || !path.matches("/[a-zA-Z0-9_./-]+") || Arrays.asList(path.split("/")).contains(".."))
            return missing();
        try {
            if (path.startsWith("/material/")) {
                List<String> parts = url.getPathSegments();
                if (parts.size() != 3 || !activeProject.equals(parts.get(1)) || !ProjectFiles.image(parts.get(2))) return missing();
                File file = ProjectFiles.material(this, activeProject, parts.get(2));
                return new WebResourceResponse(ProjectFiles.mime(file.getName()), null, new FileInputStream(file));
            }
            String name = path.substring(1);
            if (name.startsWith("data/") || name.endsWith(".sqlite")) return missing();
            String type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" :
                path.endsWith(".html") ? "text/html" : path.endsWith(".wasm") ? "application/wasm" :
                path.endsWith(".svg") ? "image/svg+xml" : ProjectFiles.mime(name);
            return new WebResourceResponse(type, type.startsWith("text/") ? "UTF-8" : null, getAssets().open(name));
        } catch (Exception ignored) { return missing(); }
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
    }

    @Override protected void onPause() {
        web.evaluateJavascript("if(typeof flush==='function') flush()", null);
        super.onPause();
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.closeScripterPanel?.() === true", handled -> {
            if (!"true".equals(handled)) super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        documents.shutdown();
        if (printView != null) printView.destroy();
        web.removeJavascriptInterface("ScripterAndroid");
        web.destroy();
        super.onDestroy();
    }

    private File preferences() { return new File(getFilesDir(), "preferences.json"); }

    public final class Bridge {
        @JavascriptInterface public String platform() { return BuildConfig.VERSION; }

        @JavascriptInterface public String call(String operation, String raw) {
            try {
                JSONObject args = new JSONObject(raw);
                Object result;
                switch (operation) {
                    case "preferences":
                        result = preferences().isFile() ? new JSONObject(ProjectFiles.read(preferences())) : new JSONObject();
                        break;
                    case "savePreferences":
                        ProjectFiles.write(preferences(), args.toString());
                        return success(true);
                    case "projects": result = files.list(); break;
                    case "load":
                        String project = args.getString("project");
                        result = new JSONObject(files.readProject(project));
                        activeProject = project;
                        break;
                    case "save":
                        String id = args.getString("project");
                        files.saveProject(id, args.getJSONObject("data").toString());
                        activeProject = id;
                        return success(true);
                    case "remove":
                        ProjectFiles.material(MainActivity.this, activeProject, args.getString("file")).delete();
                        return success(true);
                    case "insert":
                        File selected = ProjectFiles.material(MainActivity.this, activeProject, args.getString("file"));
                        try (InputStream input = new FileInputStream(selected)) {
                            if (ProjectFiles.image(selected.getName())) {
                                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                                ProjectFiles.copy(input, bytes, 8L * 1024 * 1024);
                                result = new JSONObject().put("type", "image").put("url", "data:" +
                                    ProjectFiles.mime(selected.getName()) + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                            } else result = new JSONObject().put("type", "text").put("value", ProjectFiles.readText(input, 20L * 1024 * 1024));
                        }
                        break;
                    case "dictionary": result = dictionary(args.getString("word"), args.getString("language")); break;
                    case "zoom":
                        int zoom = Math.max(75, Math.min(200, args.getInt("zoom")));
                        runOnUiThread(() -> web.getSettings().setTextZoom(zoom));
                        return success(true);
                    case "copy":
                        String text = args.getString("text");
                        runOnUiThread(() -> getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Scripter", text)));
                        return success(true);
                    default: throw new IOException("Unknown action");
                }
                return success(result);
            } catch (Exception error) { return failure("Die Aktion konnte nicht ausgeführt werden."); }
        }

        @JavascriptInterface public void request(int id, String operation, String raw) {
            runOnUiThread(() -> {
                try { begin(new Request(id, operation, new JSONObject(raw))); }
                catch (Exception error) { reply(id, failure("Keine passende Android-App oder Funktion verfügbar.")); }
            });
        }
    }

    private synchronized JSONArray dictionary(String word, String locale) throws Exception {
        if (thesaurus == null) {
            File db = new File(getFilesDir(), "thesaurus.sqlite");
            if (!db.isFile()) {
                File temp = new File(getFilesDir(), "thesaurus.part");
                try (InputStream from = getAssets().open("data/thesauri.sqlite"); OutputStream to = new FileOutputStream(temp)) {
                    ProjectFiles.copy(from, to, 160L * 1024 * 1024);
                }
                if (!temp.renameTo(db)) throw new IOException();
            }
            thesaurus = SQLiteDatabase.openDatabase(db.toString(), null, SQLiteDatabase.OPEN_READONLY);
        }
        JSONArray groups = new JSONArray();
        try (Cursor rows = thesaurus.rawQuery("SELECT senses FROM thesaurus WHERE lang=? AND word=?",
                new String[]{locale, word.trim().toLowerCase(Locale.forLanguageTag(locale))})) {
            if (rows.moveToFirst()) for (String row : rows.getString(0).split("\n")) {
                JSONArray group = new JSONArray();
                for (String term : row.split("\\|")) if (!term.isEmpty()) group.put(term);
                if (group.length() > 0) groups.put(group);
            }
        }
        return groups;
    }

    private void begin(Request request) throws Exception {
        Intent intent;
        switch (request.operation) {
            case "pick":
                intent = document(Intent.ACTION_OPEN_DOCUMENT, "*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                break;
            case "import":
                intent = document(Intent.ACTION_OPEN_DOCUMENT, "*/*").putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[]{"application/json", "application/zip", "application/x-zip-compressed", "application/octet-stream", "text/plain"});
                break;
            case "export":
            case "backup":
                intent = document(Intent.ACTION_CREATE_DOCUMENT, request.data.getString("mime"))
                    .putExtra(Intent.EXTRA_TITLE, request.data.getString("filename"));
                break;
            case "voice":
                intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, request.data.getString("language"))
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                break;
            case "openUrl":
                Uri address = Uri.parse(request.data.getString("url"));
                if (!Arrays.asList("http", "https").contains(address.getScheme()) || address.getHost() == null ||
                    address.getUserInfo() != null) throw new IllegalArgumentException("Invalid URL");
                startActivity(new Intent(Intent.ACTION_VIEW, address));
                reply(request.id, success(true));
                return;
            case "openMaterial":
                String file = request.data.getString("file");
                if (!ProjectFiles.material(this, activeProject, file).isFile()) throw new IOException("Missing material");
                Uri asset = new Uri.Builder().scheme("content").authority("de.scripter.mobile.material")
                    .appendPath(activeProject).appendPath(file).appendPath(request.data.getString("name")).build();
                startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(asset, ProjectFiles.mime(file))
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                reply(request.id, success(true));
                return;
            case "print":
                print(request);
                return;
            default: throw new IllegalArgumentException("Unknown request");
        }
        if (pending != null) throw new IllegalStateException("Another request is active");
        pending = request;
        try { startActivityForResult(intent, 1); }
        catch (RuntimeException error) { pending = null; throw error; }
    }

    private static Intent document(String action, String type) {
        return new Intent(action).setType(type).addCategory(Intent.CATEGORY_OPENABLE);
    }

    @Override protected void onActivityResult(int code, int status, Intent data) {
        super.onActivityResult(code, status, data);
        Request request = pending;
        if (code != 1 || request == null) return;
        pending = null;
        if (status != RESULT_OK || data == null) { reply(request.id, success(JSONObject.NULL)); return; }
        documents.execute(() -> {
            try { reply(request.id, success(finish(request, data))); }
            catch (Exception error) { reply(request.id, failure("Die Datei konnte nicht gelesen oder gespeichert werden.")); }
        });
    }

    private Object finish(Request request, Intent data) throws Exception {
        Uri uri = data.getData();
        switch (request.operation) {
            case "voice":
                ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                return results == null || results.isEmpty() ? "" : results.get(0);
            case "pick":
                JSONArray picked = new JSONArray();
                JSONArray errors = new JSONArray();
                ClipData list = data.getClipData();
                int size = list == null ? 1 : list.getItemCount();
                for (int i = 0; i < size; i++) {
                    Uri file = list == null ? uri : list.getItemAt(i).getUri();
                    String name = displayName(file);
                    try (InputStream in = getContentResolver().openInputStream(file)) {
                        picked.put(files.addMaterial(request.data.getString("project"), name, getContentResolver().getType(file), in));
                    } catch (Exception error) { errors.put(name); }
                }
                return new JSONObject().put("picked", picked).put("errors", errors);
            case "import":
                try (InputStream raw = getContentResolver().openInputStream(uri);
                        java.io.BufferedInputStream in = new java.io.BufferedInputStream(raw)) {
                    in.mark(2);
                    boolean archive = in.read() == 'P' && in.read() == 'K';
                    in.reset();
                    return files.importProject(in, archive);
                }
            case "backup":
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    files.exportProject(request.data.getString("project"), request.data.getString("contents"), out);
                }
                return true;
            case "export":
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    if ("application/epub+zip".equals(request.data.getString("mime"))) Epub.write(request.data, out);
                    else out.write(request.data.getString("contents").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
                return true;
            default: throw new IOException();
        }
    }

    private String displayName(Uri uri) {
        try (Cursor rows = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (rows != null && rows.moveToFirst()) return rows.getString(0);
        }
        return "Material";
    }

    private void print(Request request) throws Exception {
        String title = request.data.getString("title");
        String html = request.data.getString("html");
        if (printView != null) printView.destroy();
        printView = new WebView(this);
        printView.getSettings().setBlockNetworkLoads(true);
        printView.getSettings().setAllowFileAccess(false);
        printView.setWebViewClient(new WebViewClient() {
            private boolean started;
            @Override public void onPageFinished(WebView view, String url) {
                if (started) return;
                started = true;
                try {
                    android.print.PrintAttributes attrs = printAttributes(request.data);
                    getSystemService(PrintManager.class).print(title, view.createPrintDocumentAdapter(title), attrs);
                    reply(request.id, success("printing"));
                } catch (Exception error) { reply(request.id, failure("Das Dokument konnte nicht gedruckt werden.")); }
            }
        });
        printView.loadDataWithBaseURL(ORIGIN, html, "text/html", "UTF-8", null);
    }

    private static android.print.PrintAttributes printAttributes(JSONObject data) throws Exception {
        int width = (int) Math.round(data.getDouble("width") / 25.4 * 1000);
        int height = (int) Math.round(data.getDouble("height") / 25.4 * 1000);
        return new android.print.PrintAttributes.Builder()
            .setMediaSize(new android.print.PrintAttributes.MediaSize("scripter", "Scripter", width, height))
            .setMinMargins(android.print.PrintAttributes.Margins.NO_MARGINS)
            .setColorMode(android.print.PrintAttributes.COLOR_MODE_COLOR).build();
    }

    private static String success(Object value) {
        try { return new JSONObject().put("value", value == null ? JSONObject.NULL : value).toString(); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    private static String failure(String key) {
        try { return new JSONObject().put("error", key).toString(); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    private void reply(int id, String result) {
        runOnUiThread(() -> {
            if (!isDestroyed()) web.evaluateJavascript("window.scripterReply(" + id + "," + JSONObject.quote(result) + ")", null);
        });
    }
}
