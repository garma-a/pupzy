import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum Lang { en, ar }

/// Tracks the app's current display language and persists the choice
/// on-device. English and Arabic are never shown mixed — every screen
/// renders in exactly one language at a time via [t].
class LangProvider extends ChangeNotifier {
  static const _prefsKey = 'lang';

  Lang _lang = Lang.en;
  Lang get lang => _lang;

  Locale get locale => Locale(_lang == Lang.ar ? 'ar' : 'en');

  LangProvider() {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_prefsKey) == 'ar') {
      _lang = Lang.ar;
      notifyListeners();
    }
  }

  Future<void> setLang(Lang lang) async {
    if (_lang == lang) return;
    _lang = lang;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, lang == Lang.ar ? 'ar' : 'en');
  }
}

/// Returns [en] or [ar] depending on the app's current language.
/// Use at every user-facing string call site instead of hardcoding text.
String t(BuildContext context, String en, String ar) {
  return context.watch<LangProvider>().lang == Lang.ar ? ar : en;
}
