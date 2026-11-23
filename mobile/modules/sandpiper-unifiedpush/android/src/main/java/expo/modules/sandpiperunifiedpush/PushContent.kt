package expo.modules.sandpiperunifiedpush

import org.json.JSONObject

/**
 * What a UnifiedPush message from the organization's server says (server/src/modules/push/webpush.ts
 * webPushPayload): `{ title, body, kind: "unread", count, route }`. Only "You have N new
 * notifications" ever arrives; record details never do. Plain Kotlin, tested without a phone.
 */
data class PushContent(val title: String, val body: String, val count: Int)

object PushContentParser {
  const val MAX_TITLE = 60
  const val MAX_BODY = 160
  const val DEFAULT_TITLE = "Sandpiper GRC"

  /**
   * The notification to show, or null for anything else: a message the connector could not decrypt
   * with this phone's keys (so not from a server this phone registered with), or one that is not the
   * server's "unread" message.
   */
  fun parse(content: ByteArray, decrypted: Boolean): PushContent? {
    if (!decrypted || content.isEmpty() || content.size > 4096) return null
    val obj = try {
      JSONObject(String(content, Charsets.UTF_8))
    } catch (e: Exception) {
      return null
    }
    if (obj.optString("kind") != "unread") return null
    if (!obj.has("count")) return null
    val count = obj.optInt("count", -1)
    // 0: the administrator's test push.
    if (count < 0 || count > 1_000_000) return null
    val body = clean(obj.optString("body"), MAX_BODY)
    if (body.isEmpty()) return null
    val title = clean(obj.optString("title"), MAX_TITLE).ifEmpty { DEFAULT_TITLE }
    return PushContent(title, body, count)
  }

  /** One line of plain text: control characters become spaces, then trimmed and cut to `max`. */
  fun clean(text: String, max: Int): String =
    text.map { if (it.isISOControl()) ' ' else it }.joinToString("").trim().take(max).trim()
}

/** The subscription the app sends to the server (PUT /api/me/push, provider "unifiedpush"). */
data class Subscription(val endpoint: String, val p256dh: String, val auth: String) {
  fun toMap(): Map<String, String> = mapOf("endpoint" to endpoint, "p256dh" to p256dh, "auth" to auth)
}

object SubscriptionCheck {
  private val B64URL = Regex("^[A-Za-z0-9_-]+$")
  private val VAPID = Regex("^[A-Za-z0-9_-]{87}$")

  /** The server's VAPID public key: an uncompressed P-256 point, base64url without padding (87 characters). */
  fun vapidValid(key: String): Boolean = VAPID.matches(key.trimEnd('='))

  /**
   * The endpoint and the RFC 8291 keys the connector gave (base64url without padding: a 65-byte
   * P-256 public key is 87 characters, a 16-byte authentication secret 22), or null when something is
   * missing or malformed. The server checks the push server against its list.
   */
  fun subscription(endpoint: String?, pubKey: String?, auth: String?): Subscription? {
    if (endpoint.isNullOrBlank() || endpoint.length > 1000) return null
    if (!(endpoint.startsWith("https://") || endpoint.startsWith("http://"))) return null
    val p = pubKey?.trimEnd('=') ?: return null
    val a = auth?.trimEnd('=') ?: return null
    if (!B64URL.matches(p) || p.length != 87 || !p.startsWith("B")) return null
    if (!B64URL.matches(a) || a.length != 22) return null
    return Subscription(endpoint, p, a)
  }

  /** The error code JavaScript gets when the distributor refuses a registration (FailedReason name). */
  fun failureCode(reason: String): String = when (reason) {
    "NETWORK" -> "ERR_UNIFIEDPUSH_NETWORK"
    "ACTION_REQUIRED" -> "ERR_UNIFIEDPUSH_ACTION_REQUIRED"
    "VAPID_REQUIRED" -> "ERR_UNIFIEDPUSH_VAPID_REQUIRED"
    else -> "ERR_UNIFIEDPUSH_FAILED"
  }

  /** A short fingerprint of a subscription, kept to tell whether the distributor gave a new one. */
  fun fingerprint(s: Subscription): String {
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest("${s.endpoint}\n${s.p256dh}\n${s.auth}".toByteArray())
    return digest.take(16).joinToString("") { "%02x".format(it) }
  }
}
