// Language handling shared by every page. Each page defines window.CS_DICT = {en:{...}, es:{...}}.
(function(){
  function getLang(){
    try { const l = localStorage.getItem('cs_lang'); if (l === 'en' || l === 'es') return l; } catch(e) {}
    return (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en';
  }
  let lang = getLang();
  const listeners = [];
  function t(key, vars){
    const d = (window.CS_DICT && window.CS_DICT[lang]) || {};
    let s = d[key];
    if (s === undefined) s = (window.CS_DICT && window.CS_DICT.en[key]) || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function apply(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    const tt = t('page_title'); if (tt !== 'page_title') document.title = tt;
    listeners.forEach(fn => fn(lang));
  }
  function setLang(l){ lang = l; try { localStorage.setItem('cs_lang', l); } catch(e) {} apply(); }
  window.CS = { t, apply, setLang, lang: () => lang, onLang: fn => listeners.push(fn) };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
    apply();
  });
})();
