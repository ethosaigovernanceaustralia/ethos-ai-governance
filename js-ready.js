// Marks that JavaScript runs, before first paint (loaded synchronously in <head>).
// styles.css keeps animated content visible when this class is absent (SEO-06).
document.documentElement.classList.add('js');
