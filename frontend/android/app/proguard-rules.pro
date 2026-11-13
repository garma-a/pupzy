# Extra R8 rules for the release build. The Flutter Gradle plugin picks this
# file up next to its own Flutter rules and Android's optimize defaults.

# Move obfuscated classes into one package: smaller DEX and more obfuscation.
# Play Console's "DEX code optimization" lists this as "Repackage Classes".
# Classes a plugin looks up by name keep their names through the plugin's own
# keep rules, so this only renames classes R8 is already free to rename.
-repackageclasses
