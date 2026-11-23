package expo.modules.sandpiperunifiedpush

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import org.unifiedpush.android.connector.data.PushEndpoint

/**
 * What the push service (which Android may start while the app is closed) and the module (alive
 * while the app's JavaScript runs) share. Everything here runs on the main thread: the connector
 * calls the service there, and the module's register and unregister run on the main queue.
 *
 * - A registration in progress waits for the distributor's answer (a new endpoint or a refusal).
 * - An endpoint that arrives with nothing waiting (the distributor moved this phone to another
 *   address) is told to JavaScript as `onNewEndpoint`, which registers again with the server, but
 *   only when it differs from the last one (a fingerprint in the app's own preferences: never the
 *   endpoint itself). With the app closed, it is picked up at the next start, which registers again.
 */
object UnifiedPushState {
  const val INSTANCE = "default"
  private const val PREFS = "sandpiper.unifiedpush"
  private const val KEY_FINGERPRINT = "fingerprint"
  const val TIMEOUT_MS = 30_000L

  /** The module, while JavaScript runs: (event name, payload). */
  @Volatile var emit: ((String, Bundle) -> Unit)? = null

  private class Waiting(val resolve: (Subscription) -> Unit, val reject: (String, String) -> Unit, val timeout: Runnable)

  private val handler = Handler(Looper.getMainLooper())
  private var waiting: Waiting? = null

  /** Waits for the distributor's answer to the registration being sent now (a newer one replaces it). */
  fun await(resolve: (Subscription) -> Unit, reject: (String, String) -> Unit) {
    finish()?.reject?.invoke("ERR_UNIFIEDPUSH_SUPERSEDED", "A newer registration replaced this one.")
    lateinit var w: Waiting
    val timeout = Runnable {
      if (waiting === w) {
        waiting = null
        reject("ERR_UNIFIEDPUSH_TIMEOUT", "The push app did not answer in time.")
      }
    }
    w = Waiting(resolve, reject, timeout)
    waiting = w
    handler.postDelayed(timeout, TIMEOUT_MS)
  }

  private fun finish(): Waiting? {
    val w = waiting ?: return null
    waiting = null
    handler.removeCallbacks(w.timeout)
    return w
  }

  fun newEndpoint(context: Context, endpoint: PushEndpoint) {
    val s = SubscriptionCheck.subscription(endpoint.url, endpoint.pubKeySet?.pubKey, endpoint.pubKeySet?.auth)
    val w = finish()
    if (s == null) {
      w?.reject?.invoke("ERR_UNIFIEDPUSH_KEYS", "The push app gave an address without message keys.")
      return
    }
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val fingerprint = SubscriptionCheck.fingerprint(s)
    val changed = prefs.getString(KEY_FINGERPRINT, null) != fingerprint
    prefs.edit().putString(KEY_FINGERPRINT, fingerprint).apply()
    if (w != null) {
      w.resolve(s)
    } else if (changed) {
      emit?.invoke("onNewEndpoint", Bundle().apply { putBoolean("temporary", endpoint.temporary) })
    }
  }

  fun failed(reason: String) {
    finish()?.reject?.invoke(SubscriptionCheck.failureCode(reason), "The push app refused the registration ($reason).")
  }

  fun unregistered(context: Context) {
    forget(context)
    val w = finish()
    if (w != null) w.reject("ERR_UNIFIEDPUSH_UNREGISTERED", "The push app ended the registration.")
    else emit?.invoke("onUnregistered", Bundle())
  }

  /** Forgets the last endpoint's fingerprint (signing out, switching push off). */
  fun forget(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
