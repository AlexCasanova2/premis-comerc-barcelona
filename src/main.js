import { createApp } from "vue";
import App from "./App.vue";
import Admin from "./Admin.vue";
import "./style.css";
import "./admin.css";

createApp(window.location.pathname.startsWith("/admin") ? Admin : App).mount(
  "#app",
);
