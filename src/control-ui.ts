import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { activate } from "./dashboard.js";
import "./dashboard.css";
export default defineControlUiPlugin({ id: "tensorfold", activate });
