import { render } from "preact";
import { Root } from "./root.js";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<Root />, root);
