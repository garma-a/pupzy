// Shows one language at a time. The choice comes from ?lang=en|ar (so the app
// can link to its current language), then the visitor's last choice, then the
// browser language. Without JavaScript both languages are shown, one after
// the other.
(function () {
  var root = document.documentElement;
  root.classList.add('js');

  function remembered() {
    try { return localStorage.getItem('pupzy-lang'); } catch (e) { return null; }
  }

  function remember(lang) {
    try { localStorage.setItem('pupzy-lang', lang); } catch (e) { /* storage unavailable */ }
  }

  function initial() {
    var fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl === 'ar' || fromUrl === 'en') return fromUrl;
    var saved = remembered();
    if (saved === 'ar' || saved === 'en') return saved;
    return (navigator.language || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
  }

  function apply(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.querySelectorAll('[data-set-lang]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-set-lang') === lang));
    });
    var heading = document.querySelector('.lang-block[data-lang="' + lang + '"] h1');
    if (heading) document.title = heading.textContent + ' · Pupzy';
  }

  apply(initial());

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-lang'));
    document.querySelectorAll('[data-set-lang]').forEach(function (button) {
      button.addEventListener('click', function () {
        var lang = button.getAttribute('data-set-lang');
        remember(lang);
        apply(lang);
      });
    });
  });
})();
