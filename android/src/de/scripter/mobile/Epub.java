package de.scripter.mobile;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

final class Epub {
    private static final String XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
    private static final String XHTML = "http://www.w3.org/1999/xhtml";

    static void write(JSONObject book, OutputStream destination) throws Exception {
        JSONArray chapters = book.getJSONArray("chapters");
        JSONArray images = book.getJSONArray("images");
        String language = xml(book.getString("language"));
        String title = xml(book.getString("title"));
        String author = xml(book.getString("author"));
        StringBuilder nav = new StringBuilder();
        StringBuilder manifest = new StringBuilder("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>");
        manifest.append("<item id=\"cover\" href=\"title.xhtml\" media-type=\"application/xhtml+xml\"/>");
        manifest.append("<item id=\"style\" href=\"book.css\" media-type=\"text/css\"/>");
        StringBuilder spine = new StringBuilder("<itemref idref=\"cover\"/>");
        try (ZipOutputStream zip = new ZipOutputStream(destination)) {
            byte[] mimetype = "application/epub+zip".getBytes(StandardCharsets.US_ASCII);
            CRC32 crc = new CRC32();
            crc.update(mimetype);
            ZipEntry first = new ZipEntry("mimetype");
            first.setMethod(ZipEntry.STORED);
            first.setSize(mimetype.length);
            first.setCrc(crc.getValue());
            zip.putNextEntry(first);
            zip.write(mimetype);
            zip.closeEntry();

            entry(zip, "META-INF/container.xml", XML + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"EPUB/book.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>");
            entry(zip, "EPUB/book.css", "img{max-width:100%;height:auto}blockquote{margin-inline-start:1em}p{margin:.7em 0}");
            entry(zip, "EPUB/title.xhtml", xhtml(title, language, "<h1>" + title + "</h1><p>" + author + "</p>"));
            for (int i = 0; i < chapters.length(); i++) {
                JSONObject chapter = chapters.getJSONObject(i);
                String heading = xml(chapter.getString("title"));
                String id = "chapter-" + (i + 1);
                String name = id + ".xhtml";
                nav.append("<li><a href=\"").append(name).append("\">").append(heading).append("</a></li>");
                manifest.append("<item id=\"").append(id).append("\" href=\"").append(name)
                    .append("\" media-type=\"application/xhtml+xml\"/>");
                spine.append("<itemref idref=\"").append(id).append("\"/>");
                entry(zip, "EPUB/" + name, xhtml(heading, language, "<h1>" + heading + "</h1>" + chapter.getString("content")));
            }
            for (int i = 0; i < images.length(); i++) {
                JSONObject image = images.getJSONObject(i);
                String name = image.getString("name");
                String type = image.getString("type");
                if (!name.matches("image-[0-9]+\\.(png|jpeg|gif)") || !type.equals("image/" + ProjectFiles.extension(name)))
                    throw new IllegalArgumentException("Invalid image");
                manifest.append("<item id=\"image-").append(i).append("\" href=\"").append(name)
                    .append("\" media-type=\"").append(type).append("\"/>");
                zip.putNextEntry(new ZipEntry("EPUB/" + name));
                zip.write(Base64.decode(image.getString("bytes"), Base64.DEFAULT));
                zip.closeEntry();
            }
            String modified = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();
            entry(zip, "EPUB/book.opf", XML + "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">" +
                "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">urn:uuid:" + UUID.randomUUID() +
                "</dc:identifier><dc:title>" + title + "</dc:title><dc:creator>" + author + "</dc:creator><dc:language>" + language +
                "</dc:language><meta property=\"dcterms:modified\">" + modified + "</meta></metadata><manifest>" + manifest +
                "</manifest><spine>" + spine + "</spine></package>");
            entry(zip, "EPUB/nav.xhtml", xhtml(title, language, "<nav epub:type=\"toc\"><h1>" + title + "</h1><ol>" + nav + "</ol></nav>"));
        }
    }

    private static String xml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String xhtml(String title, String language, String body) {
        return XML + "<html xmlns=\"" + XHTML + "\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"" + language +
            "\" xml:lang=\"" + language + "\"><head><title>" + title +
            "</title><link rel=\"stylesheet\" type=\"text/css\" href=\"book.css\"/></head><body>" + body + "</body></html>";
    }

    private static void entry(ZipOutputStream zip, String name, String content) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private Epub() {}
}
