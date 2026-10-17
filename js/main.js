/* ══════════════════════════════════════════
   JMV CONSULTORES — JavaScript del sitio público
   Sin dependencias. Mejora progresiva: si falla,
   el contenido y los enlaces siguen funcionando.
   ══════════════════════════════════════════ */

/* ⚙️ CONFIGURACIÓN — datos de contacto */
const CONFIG = {
  appUrl: "https://app.jmvconsultores.cl",
  whatsapp: "56975752213", // 56 + 9 + número, sin + ni espacios
  email: "contacto@jmvconsultores.cl",
};

/* 🔗 REDES SOCIALES OFICIALES
   Único lugar donde se configuran. Las que queden vacías NO se publican:
   el bloque del pie desaparece por completo si no hay ningún perfil real.
   Ejemplo: linkedin: "https://www.linkedin.com/company/jmv-consultores" */
const REDES = {
  linkedin: "",
  instagram: "",
  facebook: "",
  youtube: "",
};

const NOMBRE_RED = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("js");

  /* ── Menú móvil ─────────────────────────────────────────────
     Disclosure accesible: aria-expanded en el botón, cierre con
     Escape y al elegir un enlace, y estado inicial correcto al
     cambiar de tamaño de pantalla. */
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("navPrincipal");
  if (toggle && nav) {
    const abrir = () => {
      nav.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Cerrar menú de navegación");
    };
    const cerrar = (devolverFoco = false) => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menú de navegación");
      if (devolverFoco) toggle.focus();
    };
    toggle.addEventListener("click", () => {
      if (toggle.getAttribute("aria-expanded") === "true") cerrar(true);
      else abrir();
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) cerrar();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") cerrar(true);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth >= 960 && toggle.getAttribute("aria-expanded") === "true") cerrar();
    });
  }

  /* ── Revelado al hacer scroll ───────────────────────────────
     Solo si el navegador lo soporta; el contenido nunca queda
     oculto por falta de JS o de IntersectionObserver. */
  const elementos = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    elementos.forEach((el) => observer.observe(el));
  } else {
    elementos.forEach((el) => el.classList.add("visible"));
  }

  /* ── Formulario de contacto ─────────────────────────────────
     Validación en el navegador con mensajes visibles y asociados
     (aria-describedby). El envío real es un handoff a WhatsApp:
     el visitante revisa el texto antes de mandarlo. */
  const formularios = document.querySelectorAll("form[data-contacto], #contactForm");
  formularios.forEach((form) => {
    const status = form.querySelector("#formStatus") || crearStatus(form);
    const campos = [...form.querySelectorAll("input[required], select[required], textarea[required]")];

    const nombreCampo = (campo) => {
      const label = form.querySelector(`label[for="${campo.id}"]`);
      return label ? label.textContent.replace("*", "").trim() : campo.name;
    };

    const mensajeError = (campo) => {
      if (campo.tagName === "SELECT" && !campo.value) return "Elige una opción.";
      if (!campo.value.trim()) return `Completa ${nombreCampo(campo).toLowerCase()}.`;
      if (campo.name === "contacto" && campo.value.trim().length < 5) {
        return "Déjanos un teléfono o correo válido para responderte.";
      }
      if (campo.name === "contacto" && !/^[+\d\s().@a-z0-9_-]+$/i.test(campo.value.trim())) {
        return "Revisa el teléfono o correo: hay caracteres que no corresponden.";
      }
      return "";
    };

    const errorDe = (campo) => {
      let error = form.querySelector(`[data-error-for="${campo.id}"]`);
      if (!error) {
        error = document.createElement("p");
        error.className = "form__error";
        error.dataset.errorFor = campo.id;
        error.id = `error-${campo.id}`;
        campo.insertAdjacentElement("afterend", error);
        const descrito = (campo.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
        descrito.push(error.id);
        campo.setAttribute("aria-describedby", descrito.join(" "));
      }
      return error;
    };

    const validar = (campo) => {
      const mensaje = mensajeError(campo);
      const error = errorDe(campo);
      error.textContent = mensaje;
      campo.setAttribute("aria-invalid", mensaje ? "true" : "false");
      return !mensaje;
    };

    campos.forEach((campo) => {
      campo.addEventListener("blur", () => {
        if (campo.value.trim()) validar(campo);
      });
      campo.addEventListener("input", () => {
        if (campo.getAttribute("aria-invalid") === "true") validar(campo);
      });
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      status.textContent = "";

      const invalido = campos.find((campo) => !validar(campo));
      if (invalido) {
        status.textContent = "Revisa los campos marcados antes de enviar.";
        invalido.focus();
        return;
      }

      // Honeypot: si viene completado, no se hace nada (bot).
      const trampa = form.querySelector('input[name="web"]');
      if (trampa && trampa.value) return;

      const datos = new FormData(form);
      const valor = (clave) => String(datos.get(clave) || "").trim();

      const lineas = [
        "Hola JMV Consultores 👋",
        `Soy *${valor("nombre")}*`,
        valor("negocio") && `Rubro/negocio: ${valor("negocio")}`,
        valor("contacto") && `Contacto: ${valor("contacto")}`,
        valor("servicio") && `Servicio de interés: *${valor("servicio")}*`,
        "",
        valor("mensaje"),
      ].filter(Boolean);

      const url = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(lineas.join("\n"))}`;
      const ventana = window.open(url, "_blank", "noopener");

      if (ventana) {
        status.textContent = "Abrimos WhatsApp en otra pestaña con tu mensaje. Revísalo y envíalo para completar la consulta.";
      } else {
        status.innerHTML =
          'Tu navegador bloqueó la ventana de WhatsApp. <a href="' + url + '" target="_blank" rel="noopener">Ábrela aquí</a> para enviar el mensaje.';
      }
    });
  });

  function crearStatus(form) {
    const p = document.createElement("p");
    p.className = "form__status";
    p.id = "formStatus";
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    form.appendChild(p);
    return p;
  }

  /* ── Datos configurables en el HTML ── */
  const waNumber = document.getElementById("whatsappNumber");
  if (waNumber) {
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

  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* ── Redes sociales oficiales ───────────────────────────────
     Solo se renderizan las que tengan URL https real. Sin perfiles
     configurados, el bloque se elimina: nunca quedan enlaces de ejemplo. */
  const bloqueRedes = document.querySelector("[data-redes]");
  if (bloqueRedes) {
    const lista = bloqueRedes.querySelector("ul");
    const activas = Object.entries(REDES).filter(([, url]) => /^https:\/\/[^\s]+$/.test(url));
    if (!activas.length) {
      bloqueRedes.remove();
    } else {
      activas.forEach(([red, url]) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener me";
        a.target = "_blank";
        a.textContent = NOMBRE_RED[red] || red;
        li.appendChild(a);
        lista.appendChild(li);
      });
      bloqueRedes.hidden = false;
    }
  }
});
