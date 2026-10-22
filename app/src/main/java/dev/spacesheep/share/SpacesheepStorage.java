package dev.spacesheep.share;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Thread-safe JSON key-value store backed by Android SharedPreferences,
 * backing `extension.storage.local` for the Spacesheep WebView UI.
 */
public final class SpacesheepStorage {
    private static final String TAG = "SpacesheepShare";
    private static final String PREFS_NAME = "spacesheep_local_storage";
    private static final String PREFS_KEY_JSON = "storage_root";

    private final SharedPreferences prefs;

    public SpacesheepStorage(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public synchronized String getAllJson() {
        return prefs.getString(PREFS_KEY_JSON, "{}");
    }

    public synchronized void setPatchJson(String patchJson) {
        try {
            JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
            JSONObject patch = new JSONObject(patchJson);
            Iterator<String> keys = patch.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                root.put(k, patch.get(k));
            }
            prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "storageSet failed", e);
        }
    }

    public synchronized void removeKeysJson(String keysJson) {
        try {
            JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
            JSONArray arr = new JSONArray(keysJson);
            for (int i = 0; i < arr.length(); i++) {
                root.remove(arr.getString(i));
            }
            prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "storageRemove failed", e);
        }
    }

    public synchronized void saveKeyDirectly(String key, String handle) {
        try {
            JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
            JSONObject auth = new JSONObject();
            auth.put("kind", "key");
            auth.put("key", key);
            root.put("auth", auth);
            if (handle != null && !handle.trim().isEmpty()) {
                JSONObject acct = new JSONObject();
                acct.put("handle", handle.trim().replaceFirst("^@", ""));
                root.put("account", acct);
            }
            prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed saving key to storage", e);
        }
    }
}
