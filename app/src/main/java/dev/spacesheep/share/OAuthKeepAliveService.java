package dev.spacesheep.share;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Lightweight foreground service that prevents Android 14/15/16's Cached App Freezer
 * from freezing the process while the user completes OAuth sign-in in the browser.
 */
public final class OAuthKeepAliveService extends Service {
    private static final String CHANNEL_ID = "spacesheep_auth";
    private static final int NOTIFICATION_ID = 4201;

    @Override
    public void onCreate() {
        super.onCreate();
        promoteToForeground();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        promoteToForeground();
        return START_NOT_STICKY;
    }

    private void promoteToForeground() {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Spacesheep Sign-In",
                        NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Keeps Spacesheep active while completing sign-in");
                nm.createNotificationChannel(channel);
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification notification = builder
                    .setContentTitle("Spacesheep")
                    .setContentText("Completing sign-in…")
                    .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                    .setOngoing(true)
                    .build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
