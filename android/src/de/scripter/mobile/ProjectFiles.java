package de.scripter.mobile;

import android.content.Context;
import android.util.AtomicFile;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

final class ProjectFiles {
    private static final long PROJECT_LIMIT = 50L * 1024 * 1024;
    private static final long MATERIAL_LIMIT = 1024L * 1024 * 1024;
    private static final String PROJECT_FILE = "roman.json";
    private static final String MATERIAL_DIR = "Material";
    private final Context context;

    ProjectFiles(Context context) { this.context = context; }

    private static String id(String value) {
        if (value == null || !value.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid project reference");
        return value;
    }

    private static String assetName(String name) {
        if (name == null || !name.matches("[a-f0-9-]{36}\\.[a-z0-9]{1,14}"))
            throw new IllegalArgumentException("Invalid material reference");
        return name;
    }

    static File material(Context context, String project, String name) {
        return new File(new File(directory(context, project), MATERIAL_DIR), assetName(name));
    }

    static String mime(String filename) {
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension(filename));
        return type == null ? "application/octet-stream" : type;
    }

    static String extension(String filename) {
        int dot = filename.lastIndexOf('.');
        String ext = dot >= 0 ? filename.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        return ext.matches("[a-z0-9]{1,14}") ? ext : "bin";
    }

    static boolean image(String filename) {
        return Arrays.asList("png", "jpg", "jpeg", "gif", "webp", "avif", "bmp").contains(extension(filename));
    }

    private static File directory(Context context, String project) {
        return new File(new File(context.getFilesDir(), "projects"), id(project));
    }

    private File manifest(String project) { return new File(directory(context, project), PROJECT_FILE); }

    static void write(File file, String value) throws IOException {
        if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) throw new IOException();
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = atomic.startWrite();
        try {
            stream.write(value.getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(stream);
        } catch (IOException error) {
            atomic.failWrite(stream);
            throw error;
        }
    }

    static String read(File file) throws IOException {
        try (InputStream stream = new AtomicFile(file).openRead()) {
            return readText(stream, PROJECT_LIMIT);
        }
    }

    static String readText(InputStream stream, long limit) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        copy(stream, bytes, limit);
        return bytes.toString(StandardCharsets.UTF_8.name());
    }

    static long copy(InputStream from, OutputStream to, long limit) throws IOException {
        byte[] buffer = new byte[32768];
        long size = 0;
        int read;
        while ((read = from.read(buffer)) != -1) {
            size += read;
            if (size > limit) throw new IOException("File exceeds size limit");
            to.write(buffer, 0, read);
        }
        return size;
    }

    String readProject(String project) throws IOException { return read(manifest(project)); }
    void saveProject(String project, String contents) throws IOException {
        if (contents.length() > PROJECT_LIMIT) throw new IOException("Project exceeds size limit");
        write(manifest(project), contents);
    }

    JSONArray list() {
        JSONArray result = new JSONArray();
        File[] projects = new File(context.getFilesDir(), "projects").listFiles();
        if (projects == null) return result;
        Arrays.sort(projects, (first, second) ->
            Long.compare(new File(second, PROJECT_FILE).lastModified(), new File(first, PROJECT_FILE).lastModified()));
        for (File entry : projects) {
            try {
                String id = id(entry.getName());
                JSONObject project = new JSONObject(readProject(id));
                result.put(new JSONObject().put("id", id).put("title", project.getString("title")));
            } catch (Exception ignored) {}
        }
        return result;
    }

    String importProject(InputStream stream, boolean archive) throws Exception {
        String project = UUID.randomUUID().toString();
        String contents = null;
        try {
            if (archive) {
                long remaining = MATERIAL_LIMIT;
                try (ZipInputStream zip = new ZipInputStream(stream)) {
                    for (ZipEntry entry; (entry = zip.getNextEntry()) != null; zip.closeEntry()) {
                        if (entry.isDirectory() && MATERIAL_DIR.concat("/").equals(entry.getName())) continue;
                        if (PROJECT_FILE.equals(entry.getName()) && contents == null) {
                            contents = readText(zip, PROJECT_LIMIT);
                        } else if (entry.getName().startsWith(MATERIAL_DIR + "/") && !entry.isDirectory()) {
                            File file = material(context, project, entry.getName().substring(MATERIAL_DIR.length() + 1));
                            if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) throw new IOException();
                            if (!file.createNewFile()) throw new IOException("Duplicate material");
                            try (OutputStream out = new FileOutputStream(file)) { remaining -= copy(zip, out, remaining); }
                        } else throw new IOException("Unexpected ZIP entry");
                    }
                }
            } else contents = readText(stream, PROJECT_LIMIT);
            validateProject(contents);
            saveProject(project, contents);
            return project;
        } catch (Exception error) {
            File dir = directory(context, project);
            File[] materialFiles = new File(dir, MATERIAL_DIR).listFiles();
            if (materialFiles != null) for (File file : materialFiles) file.delete();
            new File(dir, MATERIAL_DIR).delete();
            dir.delete();
            throw error;
        }
    }

    private static void validateProject(String contents) throws Exception {
        JSONObject snapshot = new JSONObject(contents);
        JSONArray chapters = snapshot.getJSONArray("chapters");
        JSONArray assets = snapshot.getJSONArray("assets");
        if (snapshot.getInt("version") != 1 || chapters.length() == 0 || !(snapshot.get("title") instanceof String))
            throw new IOException("Invalid project");
        for (int i = 0; i < chapters.length(); i++) {
            JSONObject chapter = chapters.getJSONObject(i);
            if (!(chapter.get("title") instanceof String) || !(chapter.get("id") instanceof String) ||
                !(chapter.get("html") instanceof String)) throw new IOException("Invalid chapter");
        }
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            id(asset.getString("id"));
            if (asset.has("file")) assetName(asset.getString("file"));
        }
    }

    void exportProject(String project, String contents, OutputStream destination) throws Exception {
        JSONArray assets = new JSONObject(contents).getJSONArray("assets");
        try (ZipOutputStream zip = new ZipOutputStream(destination)) {
            zip.putNextEntry(new ZipEntry(PROJECT_FILE));
            zip.write(contents.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if (!asset.has("file")) continue;
                File file = material(context, project, asset.getString("file"));
                if (!file.isFile()) continue;
                zip.putNextEntry(new ZipEntry(MATERIAL_DIR + "/" + file.getName()));
                try (InputStream from = new FileInputStream(file)) { copy(from, zip, MATERIAL_LIMIT); }
                zip.closeEntry();
            }
        }
    }

    JSONObject addMaterial(String project, String displayName, String type, InputStream input) throws Exception {
        String reference = UUID.randomUUID().toString();
        String filename = reference + "." + extension(displayName);
        File file = material(context, project, filename);
        if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) throw new IOException();
        try (OutputStream out = new FileOutputStream(file)) {
            copy(input, out, MATERIAL_LIMIT);
        } catch (IOException error) {
            file.delete();
            throw error;
        }
        if (type == null || "application/octet-stream".equals(type)) type = mime(filename);
        String kind = type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "audio" :
            type.startsWith("video/") ? "video" : "application/pdf".equals(type) ? "pdf" :
            type.startsWith("text/") ? "text" : "file";
        return new JSONObject().put("id", reference).put("name", displayName).put("kind", kind).put("file", filename);
    }
}
