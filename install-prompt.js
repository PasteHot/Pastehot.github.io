(function () {
  'use strict';

  const STORAGE_KEY = 'pastehot_home_screen_invite_v1';
  let installEvent = null;
  let activeDialog = null;
  let resolveInstallEvent = null;
  const installEventReady = new Promise(resolve => { resolveInstallEvent = resolve; });

  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const readChoice = () => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return ''; }
  };
  const saveChoice = value => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch {}
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    resolveInstallEvent?.(event);
    resolveInstallEvent = null;
  });

  window.addEventListener('appinstalled', () => {
    saveChoice('installed');
    closeDialog('installed');
  });

  function closeDialog(choice = 'dismissed') {
    if (!activeDialog) return;
    saveChoice(choice);
    activeDialog.remove();
    activeDialog = null;
  }

  function addStyles() {
    if (document.getElementById('pastehotInstallPromptStyles')) return;
    const style = document.createElement('style');
    style.id = 'pastehotInstallPromptStyles';
    style.textContent = `
      #pastehotInstallPrompt{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:18px;background:rgba(35,20,10,.64);backdrop-filter:blur(5px);animation:phInstallFade .18s ease-out}
      #pastehotInstallPrompt[hidden]{display:none}
      #pastehotInstallPrompt .ph-install-card{position:relative;width:min(440px,100%);max-height:min(88vh,760px);overflow:auto;padding:32px 28px 25px;border:1px solid #f0dfc8;border-radius:26px;background:linear-gradient(160deg,#fffaf3 0%,#fff 55%,#fff7eb 100%);color:#2b1a10;text-align:center;box-shadow:0 28px 90px rgba(25,12,4,.38);animation:phInstallEnter .22s ease-out}
      #pastehotInstallPrompt .ph-install-ribbon{position:absolute;top:0;left:0;right:0;height:8px;border-radius:26px 26px 0 0;background:linear-gradient(90deg,#a90f15,#d71920 48%,#efbd57 48%,#efbd57 53%,#d71920 53%,#a90f15)}
      #pastehotInstallPrompt .ph-install-close{position:absolute;top:17px;right:17px;width:36px;height:36px;border:1px solid #eadcc9;border-radius:50%;background:#fff;color:#533d2a;font-size:23px;line-height:1}
      #pastehotInstallPrompt .ph-install-logo{width:72px;height:72px;object-fit:contain;padding:7px;margin:5px 0 10px;border-radius:50%;background:#fff;box-shadow:0 7px 22px rgba(71,40,18,.13)}
      #pastehotInstallPrompt .ph-install-eyebrow{margin:0 0 8px;color:#a46d2d;font-size:10px;font-weight:950;letter-spacing:.17em}
      #pastehotInstallPrompt h2{margin:0;color:#2b1a10;font-size:clamp(23px,5vw,28px);line-height:1.15;letter-spacing:-.03em}
      #pastehotInstallPrompt .ph-install-copy{margin:0 auto;max-width:350px;color:#2b1a10;font-size:clamp(23px,5vw,28px);font-weight:700;line-height:1.15;letter-spacing:-.03em}
      #pastehotInstallPrompt .ph-install-actions{display:grid;gap:9px;margin-top:23px}
      #pastehotInstallPrompt .ph-install-actions button{min-height:49px;padding:12px 16px;border:0;border-radius:13px;font-weight:900}
      #pastehotInstallPrompt .ph-install-primary{background:linear-gradient(135deg,#d71920,#ac1017);color:white;box-shadow:0 8px 18px rgba(177,21,27,.23)}
      #pastehotInstallPrompt .ph-install-secondary{background:#f1e9df;color:#553c27}
      #pastehotInstallPrompt .ph-install-steps{display:none;margin:16px 0 0;padding:14px 15px;border:1px solid #ecdcc5;border-radius:14px;background:#fff;text-align:left;color:#594531;font-size:13px;line-height:1.55}
      #pastehotInstallPrompt[data-show-steps="true"] .ph-install-steps{display:block}
      #pastehotInstallPrompt .ph-install-steps strong{color:#321f12}
      #pastehotInstallPrompt button:focus-visible{outline:3px solid rgba(215,25,32,.38);outline-offset:3px}
      @keyframes phInstallFade{from{opacity:0}to{opacity:1}}
      @keyframes phInstallEnter{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media(prefers-reduced-motion:reduce){#pastehotInstallPrompt,#pastehotInstallPrompt .ph-install-card{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function showInstructions() {
    const dialog = activeDialog;
    if (!dialog) return;
    dialog.dataset.showSteps = 'true';
    const primary = dialog.querySelector('.ph-install-primary');
    dialog.querySelector('.ph-install-steps span').textContent = isIOS()
      ? 'En el navegador, toca Compartir y después “Agregar a Inicio”. Confirma con “Agregar”.'
      : 'Abre el menú ⋮ del navegador y elige “Instalar app” o “Agregar a pantalla de inicio”. Confirma la opción que te muestre.';
    primary.textContent = 'Continuar al menú';
    primary.onclick = () => closeDialog('dismissed');
  }

  function openDialog() {
    addStyles();
    const dialog = document.createElement('div');
    dialog.id = 'pastehotInstallPrompt';
    dialog.setAttribute('role', 'presentation');
    dialog.innerHTML = `<section class="ph-install-card" role="dialog" aria-modal="true" aria-labelledby="phInstallTitle"><div class="ph-install-ribbon"></div><button type="button" class="ph-install-close" aria-label="Cerrar">×</button><img class="ph-install-logo" src="/favicon.png" alt="Logotipo de PasteHot"><p class="ph-install-eyebrow">Saborea tu tiempo.</p><h2 class="ph-install-copy" id="phInstallTitle">Agrega PasteHot a la pantalla de inicio para volver al menú y pedir más rápido.</h2><div class="ph-install-steps"><strong>Agregar PasteHot a inicio</strong><br><span>Desde ahí podrás abrir el menú directamente cuando quieras volver a pedir.</span></div><div class="ph-install-actions"><button type="button" class="ph-install-primary">${isIOS() ? 'Ver cómo agregarla' : 'Agregar a pantalla de inicio'}</button><button type="button" class="ph-install-secondary">Ahora no</button></div></section>`;
    document.body.appendChild(dialog);
    activeDialog = dialog;
    const finish = () => closeDialog('dismissed');
    dialog.querySelector('.ph-install-close').addEventListener('click', finish);
    dialog.querySelector('.ph-install-secondary').addEventListener('click', finish);
    dialog.addEventListener('click', event => { if (event.target === dialog) finish(); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') finish(); });

    const primary = dialog.querySelector('.ph-install-primary');
    primary.addEventListener('click', async () => {
      if (isIOS()) { showInstructions(); return; }
      if (!installEvent) { showInstructions(); return; }
      const prompt = installEvent;
      installEvent = null;
      try {
        await prompt.prompt();
        const result = await prompt.userChoice;
        closeDialog(result?.outcome === 'accepted' ? 'installed' : 'dismissed');
      } catch {
        showInstructions();
      }
    });
    primary.focus();
  }

  window.PasteHotInstallPrompt = {
    async showBeforeStoreSelection() {
      const isDeployPreview = window.location.hostname.startsWith('deploy-preview-') && window.location.hostname.endsWith('.netlify.app');
      const forcePreview = isDeployPreview && new URLSearchParams(window.location.search).get('install-preview') === '1';
      if (!forcePreview && (isStandalone() || readChoice() === 'installed')) {
        saveChoice('installed');
        return;
      }
      if (!forcePreview && (readChoice() || (!isIOS() && !isAndroid()))) return;
      if (!forcePreview && isAndroid() && !installEvent) {
        await Promise.race([installEventReady, new Promise(resolve => setTimeout(resolve, 900))]);
      }
      openDialog();
      await new Promise(resolve => {
        const originalRemove = activeDialog.remove.bind(activeDialog);
        activeDialog.remove = () => { originalRemove(); resolve(); };
      });
    }
  };
})();
