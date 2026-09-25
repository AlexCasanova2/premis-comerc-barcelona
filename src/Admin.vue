<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";

const credentials = reactive({ username: "admin", password: "" });
const auth = ref(false);
let expiryTimer;
const registrations = ref([]);
const query = ref("");
const loading = ref(false);
const exporting = ref(false);
const deletingId = ref(null);
const error = ref("");

const filteredRegistrations = computed(() => {
  const term = query.value.trim().toLocaleLowerCase("ca");
  if (!term) return registrations.value;
  return registrations.value.filter((entry) =>
    [
      entry.nom,
      entry.cognom,
      entry.email,
      entry.telefon,
      entry.entitat,
      entry.adreca,
    ]
      .join(" ")
      .toLocaleLowerCase("ca")
      .includes(term),
  );
});

const stats = computed(() => ({
  total: registrations.value.length,
  attending: registrations.value.filter((entry) => entry.assistencia === "Sí")
    .length,
  companions: registrations.value.filter((entry) => entry.acompanyant === "Sí")
    .length,
  mobility: registrations.value.filter((entry) => entry.mobilitat === "Sí")
    .length,
}));

function clearSession() {
  clearTimeout(expiryTimer);
  auth.value = false;
  registrations.value = [];
  query.value = "";
}

function setSession(expiresAt) {
  clearTimeout(expiryTimer);
  auth.value = true;
  expiryTimer = setTimeout(
    () => {
      clearSession();
      error.value = "La sessió ha caducat. Torna a iniciar sessió.";
    },
    Math.max(0, expiresAt - Date.now()),
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const result = await response.json();
    throw new Error(result.error || "No s’ha pogut completar l’operació.");
  }
  return response;
}

async function loadRegistrations() {
  loading.value = true;
  error.value = "";
  try {
    const response = await api("/api/admin/inscripcions");
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || "No s’han pogut carregar les inscripcions.",
      );
    if (auth.value) registrations.value = result.registrations;
  } catch (cause) {
    error.value =
      cause instanceof TypeError
        ? "No s’ha pogut connectar amb el servidor."
        : cause.message;
  } finally {
    loading.value = false;
  }
}

async function login() {
  if (loading.value || !credentials.username || !credentials.password) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const result = await response.json();
    setSession(result.expiresAt);
    await loadRegistrations();
  } catch (cause) {
    error.value = cause.message;
  } finally {
    credentials.password = "";
    loading.value = false;
  }
}

async function logout() {
  clearSession();
  try {
    await api("/api/admin/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    error.value = "";
  } catch {
    error.value =
      "No s’ha pogut revocar la sessió al servidor. Torna a provar de tancar-la.";
  }
}

async function exportCsv() {
  exporting.value = true;
  error.value = "";
  try {
    const response = await api("/api/admin/inscripcions.csv");
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "No s’ha pogut exportar el CSV.");
    }
    const blob = await response.blob();
    if (!auth.value) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "inscripcions-premi-comerc-barcelona.csv";
    link.click();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    exporting.value = false;
  }
}

async function softDelete(entry) {
  if (
    deletingId.value ||
    !window.confirm(
      `Vols donar de baixa la inscripció de ${entry.nom} ${entry.cognom}? Deixarà d’aparèixer al CRM i al CSV.`,
    )
  )
    return;
  deletingId.value = entry.id;
  error.value = "";
  try {
    await api(`/api/admin/inscripcions/${entry.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (auth.value)
      registrations.value = registrations.value.filter(
        (item) => item.id !== entry.id,
      );
  } catch (cause) {
    error.value = cause.message;
  } finally {
    deletingId.value = null;
  }
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ca-ES", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

onMounted(async () => {
  document.title = "Inscripcions · CRM Premi Comerç";
  // Remove credentials left by the previous Basic Auth implementation.
  sessionStorage.removeItem("premi-admin-auth");
  loading.value = true;
  try {
    const response = await api("/api/admin/session");
    const result = await response.json();
    setSession(result.expiresAt);
    await loadRegistrations();
  } catch {
    clearSession();
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => clearTimeout(expiryTimer));
</script>

<template>
  <main class="admin-shell">
    <section v-if="!auth" class="login-panel" aria-labelledby="login-title">
      <a class="admin-wordmark" href="/">Premi Comerç<span>.</span></a>
      <p class="admin-kicker">ÀREA PRIVADA</p>
      <h1 id="login-title">Gestió d’inscripcions</h1>
      <p>
        Identifica’t per consultar i exportar les dades de les persones
        inscrites.
      </p>
      <form @submit.prevent="login">
        <label for="admin-user"
          >Usuari<input
            id="admin-user"
            v-model.trim="credentials.username"
            aria-label="Usuari"
            autocomplete="username"
            required
        /></label>
        <label for="admin-password"
          >Contrasenya<input
            id="admin-password"
            v-model="credentials.password"
            type="password"
            aria-label="Contrasenya"
            autocomplete="current-password"
            required
        /></label>
        <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
        <button v-if="error.includes('revocar')" type="button" @click="logout">
          Torna a tancar la sessió
        </button>
        <button type="submit" :disabled="loading">
          {{ loading ? "Entrant…" : "Entra al CRM" }}
          <span aria-hidden="true">→</span>
        </button>
      </form>
      <a class="back-link" href="/">← Torna al formulari</a>
    </section>

    <template v-else>
      <header class="admin-header">
        <div>
          <a class="admin-wordmark" href="/">Premi Comerç<span>.</span></a
          ><span class="admin-badge">CRM</span>
        </div>
        <button class="logout-button" type="button" @click="logout">
          Tanca la sessió
        </button>
      </header>

      <div class="admin-content">
        <div class="admin-title-row">
          <div>
            <p class="admin-kicker">GESTIÓ DE DADES</p>
            <h1>Inscripcions</h1>
            <p>
              Consulta les respostes rebudes i exporta-les en un únic document.
            </p>
          </div>
          <button
            class="export-button"
            type="button"
            :disabled="exporting"
            @click="exportCsv"
          >
            <span aria-hidden="true">↓</span>
            {{ exporting ? "Preparant…" : "Exporta-ho tot en CSV" }}
          </button>
        </div>

        <section class="stats-grid" aria-label="Resum d’inscripcions">
          <article>
            <span>Total</span><strong>{{ stats.total }}</strong
            ><small>inscripcions rebudes</small>
          </article>
          <article>
            <span>Assistència</span><strong>{{ stats.attending }}</strong
            ><small>confirmacions</small>
          </article>
          <article>
            <span>Acompanyant</span><strong>{{ stats.companions }}</strong
            ><small>amb acompanyant</small>
          </article>
          <article>
            <span>Accessibilitat</span><strong>{{ stats.mobility }}</strong
            ><small>sol·licituds</small>
          </article>
        </section>

        <section class="registrations-panel" aria-labelledby="list-title">
          <div class="list-toolbar">
            <div>
              <h2 id="list-title">Totes les inscripcions</h2>
              <span>{{ filteredRegistrations.length }} resultats</span>
            </div>
            <label class="admin-search"
              ><span class="sr-only">Cerca inscripcions</span
              ><span aria-hidden="true">⌕</span
              ><input
                v-model="query"
                type="search"
                aria-label="Cerca inscripcions"
                placeholder="Cerca per nom, correu o entitat"
            /></label>
          </div>
          <p v-if="error" class="admin-error table-error" role="alert">
            {{ error }}
          </p>
          <div v-if="loading" class="empty-state">Carregant inscripcions…</div>
          <div v-else-if="!filteredRegistrations.length" class="empty-state">
            {{
              query
                ? "No hi ha resultats per a aquesta cerca."
                : "Encara no hi ha cap inscripció."
            }}
          </div>
          <div v-else class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Persona</th>
                  <th>Contacte</th>
                  <th>Entitat</th>
                  <th>Assistència</th>
                  <th>Acompanyant</th>
                  <th>Mobilitat</th>
                  <th>Interès butlletí</th>
                  <th>Accions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in filteredRegistrations" :key="entry.id">
                  <td data-label="Data">{{ formatDate(entry.createdAt) }}</td>
                  <td data-label="Persona">
                    <strong>{{ entry.nom }} {{ entry.cognom }}</strong>
                  </td>
                  <td data-label="Contacte">
                    <a :href="`mailto:${entry.email}`">{{ entry.email }}</a
                    ><small>{{ entry.telefon }}</small>
                  </td>
                  <td data-label="Entitat">
                    <strong>{{ entry.entitat }}</strong
                    ><small>{{ entry.adreca }}</small>
                  </td>
                  <td data-label="Assistència">
                    <span
                      class="status"
                      :class="entry.assistencia === 'Sí' ? 'yes' : 'no'"
                      >{{ entry.assistencia }}</span
                    >
                  </td>
                  <td data-label="Acompanyant">
                    <span
                      class="status"
                      :class="entry.acompanyant === 'Sí' ? 'yes' : 'no'"
                      >{{ entry.acompanyant }}</span
                    ><small v-if="entry.acompanyant === 'Sí'"
                      >{{ entry.nomAcompanyant }}
                      {{ entry.cognomAcompanyant }}</small
                    >
                  </td>
                  <td data-label="Mobilitat">
                    <span
                      class="status"
                      :class="entry.mobilitat === 'Sí' ? 'attention' : 'no'"
                      >{{ entry.mobilitat }}</span
                    >
                  </td>
                  <td data-label="Interès butlletí">
                    <span
                      v-if="typeof entry.butlletiComerc === 'boolean'"
                      class="status"
                      :class="entry.butlletiComerc ? 'yes' : 'no'"
                      >{{ entry.butlletiComerc ? "Sí" : "No" }}</span
                    >
                    <span v-else>—</span>
                  </td>
                  <td data-label="Accions">
                    <button
                      class="delete-button"
                      type="button"
                      :disabled="deletingId !== null"
                      :aria-label="`Dona de baixa la inscripció de ${entry.nom} ${entry.cognom}`"
                      @click="softDelete(entry)"
                    >
                      {{ deletingId === entry.id ? "Donant de baixa…" : "Dona de baixa" }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
