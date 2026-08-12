// Drag & drop para las cajas ALTAS y VENTAS.
(() => {
  const ACCEPTED = ['pdf', 'xlsx', 'xls', 'csv'];

  function extension(file) {
    return (file?.name || '').split('.').pop().toLowerCase();
  }

  function validFile(file) {
    return file && ACCEPTED.includes(extension(file));
  }

  function attachDropZone(id) {
    const input = document.getElementById(id);
    const zone = document.getElementById(`${id}-zone`);
    if (!input || !zone) return;

    ['dragenter', 'dragover'].forEach(type => {
      zone.addEventListener(type, event => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.add('dragging');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
    });

    ['dragleave', 'dragend'].forEach(type => {
      zone.addEventListener(type, event => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove('dragging');
      });
    });

    zone.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove('dragging');

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      if (!validFile(file)) {
        const helper = document.getElementById('helper');
        if (helper) helper.textContent = 'Formato no compatible. Usá PDF, XLSX, XLS o CSV.';
        zone.classList.add('drop-error');
        setTimeout(() => zone.classList.remove('drop-error'), 1200);
        return;
      }

      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // Evita que el navegador abra el archivo si se suelta fuera de una caja.
  ['dragover', 'drop'].forEach(type => {
    window.addEventListener(type, event => event.preventDefault());
  });

  attachDropZone('altas');
  attachDropZone('ventas');
})();
