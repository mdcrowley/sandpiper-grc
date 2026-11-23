# UnifiedPush connector (E38-14): the push service is named in the manifest (kept by R8 already);
# Tink's optional parts that are left out of the build (key downloads, Conscrypt) are not missing classes.
-dontwarn com.google.api.client.**
-dontwarn org.conscrypt.**
-dontwarn javax.annotation.**
-dontwarn com.google.errorprone.annotations.**
