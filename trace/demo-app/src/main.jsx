// Demo shell (hand-written, not generated): installs the mock API and renders the route.
import React from "react";
import { createRoot } from "react-dom/client";
import { installMockApi } from "./features/categories/mocks/categories.mock.js";
import CategoriesRoute from "./features/categories/route/CategoriesRoute.jsx";
import "./styles.css";

installMockApi({ delay: 200 });
createRoot(document.getElementById("root")).render(<CategoriesRoute />);
