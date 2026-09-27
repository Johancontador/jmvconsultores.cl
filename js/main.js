/* ══════════════════════════════════════════
   JMV CONSULTORES — JavaScript principal
   ══════════════════════════════════════════ */

/* ⚙️ CONFIGURACIÓN — EDITA AQUÍ TUS DATOS REALES */
const CONFIG = {
  whatsapp: "56975752213", // ✅ Número real: 56 + 9 + número, sin + ni espacios
  email: "contacto@jmvconsultores.cl",
};

document.addEventListener("DOMContentLoaded", () => {
  /* ── Menú móvil ── */
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );

  /* ── Animaciones reveal on scroll ── */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

  /* ── Contadores animados del hero ── */
  const counters = document.querySelectorAll("[data-counter]");
  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.counter, 10);
        const duration = 1200;
        const start = performance.now();
        const tick = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          el.textContent = Math.round(target * progress);
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        counterObserver.unobserve(el);
      });
    },
    { threshold: 0.5 }
  );
  counters.forEach((c) => counterObserver.observe(c));

  /* ── Formulario → WhatsApp ── */
  const form = document.getElementById("contactForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const nombre = form.nombre.value.trim();
    const negocio = form.negocio.value.trim();
    const servicio = form.servicio.value;
    const mensaje = form.mensaje.value.trim();

    if (!nombre || !negocio || !servicio || !mensaje) {
      form.reportValidity();
      return;
    }

    const texto = [
      "Hola JMV Consultores 👋",
      `Soy *${nombre}*`,
      negocio && `Rubro/negocio: ${negocio}`,
      `Servicio de interés: *${servicio}*`,
      "",
      mensaje,
    ]
      .filter(Boolean)
      .join("\n");

    const url = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  });

  /* ── Datos configurables en el HTML ── */
  const waNumber = document.getElementById("whatsappNumber");
  if (waNumber) {
    // Formato: +56 9 7575 2213
    const n = CONFIG.whatsapp;
    waNumber.textContent = `+${n.slice(0, 2)} ${n.slice(2, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  }

  const emailText = document.getElementById("emailText");
  const emailLink = document.getElementById("emailLink");
  if (emailText) emailText.textContent = CONFIG.email;
  if (emailLink) emailLink.href = `mailto:${CONFIG.email}`;

  const waFloat = document.getElementById("waFloat");
  if (waFloat) waFloat.href = `https://wa.me/${CONFIG.whatsapp}`;

  const waLink = document.getElementById("whatsappLink");
  if (waLink) {
    waLink.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, quisiera una consulta contable gratis")}`;
  }

  /* ── Año actual en el footer ── */
  document.getElementById("year").textContent = new Date().getFullYear();
});
