package de.scripter.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

public final class MaterialProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    private File file(Uri uri) {
        List<String> parts = uri.getPathSegments();
        if (parts.size() != 3) throw new IllegalArgumentException("Invalid material reference");
        return ProjectFiles.material(getContext(), parts.get(0), parts.get(1));
    }

    @Override public String getType(Uri uri) { return ProjectFiles.mime(file(uri).getName()); }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        String[] columns = projection == null ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        File file = file(uri);
        if (!file.isFile()) return null;
        MatrixCursor result = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = result.newRow();
        for (String column : columns) {
            row.add(OpenableColumns.DISPLAY_NAME.equals(column) ? uri.getLastPathSegment() :
                OpenableColumns.SIZE.equals(column) ? file.length() : null);
        }
        return result;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String sel, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String sel, String[] args) { throw new UnsupportedOperationException(); }
}
