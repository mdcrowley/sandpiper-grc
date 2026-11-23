package expo.modules.sandpiperunifiedpush

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log

/**
 * Shows a UnifiedPush message as a notification. The same channel and tag as the other services use
 * (shared/push-api.ts PUSH_ANDROID_CHANNEL and PUSH_COLLAPSE_KEY), so a newer push replaces an older
 * one. Tapping it opens the app with EXTRA_OPEN, which the module tells JavaScript (`onOpened`, or
 * `takeOpened()` at start); JavaScript opens Notifications only while signed in.
 */
object Notifier {
  const val CHANNEL = "notifications"
  const val TAG = "grcunread"
  const val ID = 1
  const val EXTRA_OPEN = "expo.modules.sandpiperunifiedpush.OPEN"
  private const val LOG = "SandpiperUnifiedPush"

  fun show(context: Context, content: PushContent) {
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    if (!nm.areNotificationsEnabled()) return
    if (nm.getNotificationChannel(CHANNEL) == null) {
      // The app creates it at start (expo-notifications, with the same name); this covers a push that
      // arrives before then.
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Notifications", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "How many new notifications you have in Sandpiper GRC"
      })
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      putExtra(EXTRA_OPEN, true)
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val builder = Notification.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(content.title)
      .setContentText(content.body)
      .setNumber(content.count)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
    if (open != null) {
      builder.setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    try {
      nm.notify(TAG, ID, builder.build())
    } catch (e: SecurityException) {
      // Notifications were turned off for the app between the check and now.
      Log.w(LOG, "Could not show the notification: ${e.message}")
    }
  }

  /** expo-notifications' notification icon when the app sets one, otherwise the app's icon. */
  private fun smallIcon(context: Context): Int {
    try {
      val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      val icon = info.metaData?.getInt("expo.modules.notifications.default_notification_icon", 0) ?: 0
      if (icon != 0) return icon
    } catch (e: Exception) {
      // Fall through to the app's icon.
    }
    return context.applicationInfo.icon
  }
}
