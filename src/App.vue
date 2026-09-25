<script setup>
import { nextTick, reactive, ref, watch } from "vue";

const officialUrl =
  "https://ajuntament.barcelona.cat/comerc/ca/tens-un-establiment/premi-comerc-de-barcelona";
const initialForm = () => ({
  website: "",
  nom: "",
  cognom: "",
  email: "",
  telefon: "",
  acompanyant: "",
  nomAcompanyant: "",
  cognomAcompanyant: "",
  entitat: "",
  adreca: "",
  assistencia: "",
  mobilitat: "",
  consentiment: false,
  butlletiComerc: false,
});
const form = reactive(initialForm());
const pending = ref(false);
const success = ref(false);
const error = ref("");
const successPanel = ref(null);
const questions = [
  {
    key: "assistencia",
    label: "Confirmació d’assistència",
    hint: "Confirma si assistiràs a l’acte de lliurament.",
  },
  {
    key: "mobilitat",
    label: "Requereixes algun tipus d’assistència per mobilitat reduïda?",
    hint: "Volem que puguis gaudir de l’acte amb totes les comoditats.",
  },
];
watch(
  () => form.acompanyant,
  (value) => {
    if (value !== "Sí") {
      form.nomAcompanyant = "";
      form.cognomAcompanyant = "";
    }
  },
);

async function submit() {
  if (pending.value) return;
  pending.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/inscripcions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new Error(
        result.error ||
          "No s’ha pogut enviar la inscripció. Torna-ho a provar.",
      );
    success.value = true;
    Object.assign(form, initialForm());
    await nextTick();
    successPanel.value?.focus();
    successPanel.value?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (cause) {
    error.value =
      cause.name === "TimeoutError" || cause instanceof TypeError
        ? "No hem pogut connectar amb el servidor. Comprova la connexió i torna-ho a provar."
        : cause.message;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <a class="skip-link" href="#inscripcio">Vés al formulari</a>
  <main>
    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" class="sr-only">Premi Comerç de Barcelona 2026</h1>
      <img
        class="hero-banner"
        src="/banner-premi-comerc-2026.png"
        alt="Barcelona, Capital Europea del Comerç Local 2026. Premi Comerç Barcelona 2026."
        width="1920"
        height="444"
        fetchpriority="high"
      />
    </section>

    <section class="form-intro wrap" aria-labelledby="intro-title">
      <p class="eyebrow red-text">ENS HI ACOMPANYES?</p>
      <h2 id="intro-title">Tu també formes part del premi.</h2>
      <p>
        Confirma la teva assistència a l’acte de lliurament del Premi Comerç de
        Barcelona.
      </p>
    </section>

    <section
      id="inscripcio"
      class="registration wrap"
      aria-labelledby="registration-title"
    >
      <div class="form-card">
        <div
          v-if="success"
          ref="successPanel"
          class="success-panel"
          role="status"
          tabindex="-1"
        >
          <span class="success-icon" aria-hidden="true">✓</span>
          <p class="eyebrow red-text">GRÀCIES PER INSCRIURE’T</p>
          <h2>Inscripció rebuda correctament.</h2>
          <p>
            Hem rebut les teves dades i la teva resposta d’assistència al Premi
            Comerç de Barcelona.
          </p>
          <a class="text-link" :href="officialUrl"
            >Més sobre el premi <span aria-hidden="true">↗</span></a
          >
        </div>
        <form v-else @submit.prevent="submit" :aria-busy="pending">
          <div class="honeypot" aria-hidden="true">
            <label for="website"
              >Lloc web<input
                id="website"
                v-model="form.website"
                name="website"
                tabindex="-1"
                autocomplete="off"
            /></label>
          </div>
          <div class="form-heading">
            <h2 id="registration-title">Inscripció a l’acte</h2>
            <p>
              Els camps marcats amb <span class="required">*</span> són
              obligatoris.
            </p>
          </div>
          <fieldset :disabled="pending" class="form-section">
            <legend>
              <span class="section-number">01</span> Les teves dades
            </legend>
            <div class="field-grid">
              <label for="nom"
                >Nom <span class="required">*</span
                ><input
                  id="nom"
                  v-model.trim="form.nom"
                  name="given-name"
                  autocomplete="given-name"
                  placeholder="El teu nom"
                  required
                  maxlength="150"
              /></label>
              <label for="cognom"
                >Cognom <span class="required">*</span
                ><input
                  id="cognom"
                  v-model.trim="form.cognom"
                  name="family-name"
                  autocomplete="family-name"
                  placeholder="El teu cognom"
                  required
                  maxlength="150"
              /></label>
              <label for="email"
                >Correu electrònic <span class="required">*</span
                ><input
                  id="email"
                  v-model.trim="form.email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  placeholder="nom@exemple.cat"
                  required
                  maxlength="254"
              /></label>
              <label for="telefon"
                >Telèfon <span class="required">*</span
                ><input
                  id="telefon"
                  v-model.trim="form.telefon"
                  name="tel"
                  type="tel"
                  autocomplete="tel"
                  placeholder="El teu telèfon"
                  required
                  pattern="[+0-9\(\) .\-]{6,25}"
                  maxlength="25"
                  title="Introdueix un telèfon vàlid, amb entre 6 i 25 caràcters."
              /></label>
            </div>
          </fieldset>

          <fieldset :disabled="pending" class="form-section">
            <legend>
              <span class="section-number">02</span> Entitat o associació
            </legend>
            <div class="field-grid">
              <label class="full-width" for="entitat"
                >Nom de l’entitat i/o l’associació a la qual pertanys
                <span class="required">*</span
                ><input
                  id="entitat"
                  v-model.trim="form.entitat"
                  name="organization"
                  autocomplete="organization"
                  placeholder="Nom de l’entitat o associació"
                  required
                  maxlength="300"
              /></label>
              <label class="full-width" for="adreca"
                >Adreça de l’entitat <span class="required">*</span
                ><input
                  id="adreca"
                  v-model.trim="form.adreca"
                  name="street-address"
                  autocomplete="street-address"
                  placeholder="Carrer, número i població"
                  required
                  maxlength="500"
              /></label>
            </div>
          </fieldset>

          <fieldset :disabled="pending" class="form-section attendance-section">
            <legend>
              <span class="section-number">03</span> La teva assistència
            </legend>
            <fieldset class="question">
              <legend>
                Portaràs acompanyant? <span class="required">*</span>
              </legend>
              <div class="radio-options">
                <label
                  v-for="answer in ['Sí', 'No']"
                  :key="answer"
                  class="radio-option"
                  :class="{ selected: form.acompanyant === answer }"
                  ><input
                    v-model="form.acompanyant"
                    type="radio"
                    name="acompanyant"
                    :value="answer"
                    required
                  />{{ answer }}</label
                >
              </div>
            </fieldset>
            <div
              v-if="form.acompanyant === 'Sí'"
              class="field-grid companion-fields"
            >
              <label for="nom-acompanyant"
                >Nom de l’acompanyant <span class="required">*</span
                ><input
                  id="nom-acompanyant"
                  v-model.trim="form.nomAcompanyant"
                  required
                  maxlength="150"
                  autocomplete="off"
              /></label>
              <label for="cognom-acompanyant"
                >Cognom de l’acompanyant <span class="required">*</span
                ><input
                  id="cognom-acompanyant"
                  v-model.trim="form.cognomAcompanyant"
                  required
                  maxlength="150"
                  autocomplete="off"
              /></label>
            </div>
            <fieldset
              v-for="question in questions"
              :key="question.key"
              class="question"
            >
              <legend>
                {{ question.label }} <span class="required">*</span>
              </legend>
              <p :id="`${question.key}-hint`" class="field-hint">
                {{ question.hint }}
              </p>
              <div class="radio-options">
                <label
                  v-for="answer in ['Sí', 'No']"
                  :key="answer"
                  class="radio-option"
                  :class="{ selected: form[question.key] === answer }"
                  ><input
                    v-model="form[question.key]"
                    type="radio"
                    :name="question.key"
                    :value="answer"
                    :aria-describedby="`${question.key}-hint`"
                    required
                  />{{ answer }}</label
                >
              </div>
            </fieldset>
          </fieldset>

          <div class="form-bottom">
            <label class="consent"
              ><input
                v-model="form.consentiment"
                type="checkbox"
                name="consentiment"
                required
                :disabled="pending"
              /><span
                >Accepto el tractament de les meves dades amb la finalitat
                d’inscriure’m a l’activitat indicada, d’acord amb el tractament
                0459 de promoció del comerç de Barcelona.
                <span class="required">*</span></span
              ></label
            >
            <div class="newsletter-option">
              <label class="consent"
                ><input
                  v-model="form.butlletiComerc"
                  type="checkbox"
                  name="butlletiComerc"
                  :disabled="pending"
                /><span>M’interessa subscriure’m al butlletí de comerç (opcional).</span></label
              >
              <p>
                Per completar la subscripció, accedeix al
                <a href="https://comunica.barcelona.cat/form/comerc" target="_blank" rel="noopener noreferrer">formulari del butlletí de comerç <span aria-hidden="true">↗</span></a>.
              </p>
            </div>
            <p v-if="error" class="error-message" role="alert">{{ error }}</p>
            <button
              class="primary-button submit-button"
              type="submit"
              :disabled="pending"
            >
              {{ pending ? "Enviant inscripció…" : "Envia la inscripció"
              }}<span aria-hidden="true">{{ pending ? "◌" : "→" }}</span>
            </button>
            <p class="submission-note">
              Un cop enviat el formulari, veuràs la confirmació de recepció.
            </p>
          </div>
        </form>
      </div>
    </section>

    <section class="closing">
      <div class="wrap">
        <span class="closing-flower" aria-hidden="true">✳</span>
        <p>
          El comerç dona vida a Barcelona.<br /><strong
            >I tu en formes part.</strong
          >
        </p>
        <span class="closing-label">PREMI COMERÇ<br />DE BARCELONA</span>
      </div>
    </section>
  </main>

  <footer class="wrap">
    <div>
      <img
        class="footer-brand"
        src="/AJBCN_Sign_Com_Negre_Transparent.svg"
        alt="Ajuntament de Barcelona"
      />
      <p>Ajuntament de Barcelona · Comerç</p>
    </div>
    <div class="footer-links">
      <a href="https://ajuntament.barcelona.cat/ca/avis-legal">Avís legal</a
      ><a :href="officialUrl"
        >Web de Comerç <span aria-hidden="true">↗</span></a
      >
    </div>
  </footer>
</template>
