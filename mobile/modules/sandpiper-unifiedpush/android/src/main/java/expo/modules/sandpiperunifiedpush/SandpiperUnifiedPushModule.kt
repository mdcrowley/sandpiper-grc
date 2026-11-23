package expo.modules.sandpiperunifiedpush

import android.content.Context
import android.os.Bundle
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.ResolvedDistributor

/**
 * The app's UnifiedPush connector (E38-14), for Android phones without Google's services: the person's
 * distributor app (connected to a push server the organization allows) gives an endpoint, which the
 * JavaScript side (mobile/src/push) registers with the organization's server with the message keys.
 *
 * JavaScript: register(vapidPublicKey) → { endpoint, p256dh, auth }; unregister(); distributors();
 * currentDistributor(); pickDistributor() → whether one was chosen; takeOpened() → whether the app was
 * opened by tapping a push. Events: onNewEndpoint (register again), onUnregistered, onOpened.
 */
class SandpiperUnifiedPushModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun distributorInfo(pkg: String): Map<String, String> {
    val name = try {
      val pm = context.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
      pkg
    }
    return mapOf("id" to pkg, "name" to name)
  }

  private fun current(): String? = UnifiedPush.getAckDistributor(context) ?: UnifiedPush.getSavedDistributor(context)

  /** Asks the chosen distributor for an endpoint tied to the server's VAPID key, and waits for the answer. */
  private fun send(vapid: String, promise: Promise) {
    UnifiedPushState.await(
      { s -> promise.resolve(s.toMap()) },
      { code, message -> promise.reject(code, message, null) },
    )
    try {
      UnifiedPush.register(context, UnifiedPushState.INSTANCE, "Sandpiper GRC", vapid)
    } catch (e: Exception) {
      UnifiedPushState.failed("INTERNAL_ERROR")
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SandpiperUnifiedPush")

    Events("onNewEndpoint", "onUnregistered", "onOpened")

    OnCreate {
      UnifiedPushState.emit = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      UnifiedPushState.emit = null
    }

    OnNewIntent { intent ->
      if (intent.getBooleanExtra(Notifier.EXTRA_OPEN, false)) {
        intent.removeExtra(Notifier.EXTRA_OPEN)
        sendEvent("onOpened", Bundle())
      }
    }

    AsyncFunction("register") { vapidPublicKey: String, promise: Promise ->
      if (!SubscriptionCheck.vapidValid(vapidPublicKey)) {
        promise.reject("ERR_UNIFIEDPUSH_VAPID", "The server's UnifiedPush key is not a P-256 public key.", null)
        return@AsyncFunction
      }
      val vapid = vapidPublicKey.trimEnd('=')
      if (current() != null) {
        send(vapid, promise)
        return@AsyncFunction
      }
      // No push app chosen yet: the one the person set as default, the only one installed, or the
      // system's chooser when there are several.
      when (val resolved = UnifiedPush.resolveDefaultDistributor(context)) {
        ResolvedDistributor.NoneAvailable ->
          promise.reject("ERR_NO_DISTRIBUTOR", "No UnifiedPush distributor app is installed on this phone.", null)
        is ResolvedDistributor.Found -> {
          UnifiedPush.saveDistributor(context, resolved.packageName)
          send(vapid, promise)
        }
        ResolvedDistributor.ToSelect -> {
          val activity = appContext.currentActivity
          if (activity == null) {
            promise.reject("ERR_UNIFIEDPUSH_NO_SCREEN", "Open the app to choose a push app.", null)
          } else {
            UnifiedPush.tryUseDefaultDistributor(activity) { chosen ->
              if (chosen) send(vapid, promise)
              else promise.reject("ERR_NO_DISTRIBUTOR", "No UnifiedPush distributor app was chosen.", null)
            }
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unregister") { promise: Promise ->
      try {
        UnifiedPush.unregister(context, UnifiedPushState.INSTANCE)
      } catch (e: Exception) {
        // Nothing registered.
      }
      UnifiedPushState.forget(context)
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    Function("distributors") {
      UnifiedPush.getDistributors(context).filter { it != context.packageName }.map { distributorInfo(it) }
    }

    Function("currentDistributor") {
      current()?.let { distributorInfo(it) }
    }

    AsyncFunction("pickDistributor") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      UnifiedPush.tryPickDistributor(activity) { chosen -> promise.resolve(chosen) }
    }.runOnQueue(Queues.MAIN)

    Function("takeOpened") {
      val intent = appContext.currentActivity?.intent
      if (intent != null && intent.getBooleanExtra(Notifier.EXTRA_OPEN, false)) {
        intent.removeExtra(Notifier.EXTRA_OPEN)
        true
      } else {
        false
      }
    }
  }
}
