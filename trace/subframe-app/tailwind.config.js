/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "./src/ui-v2/**/*.{tsx,ts,js,jsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
  presets: [require("./src/ui-v2/tailwind.config.js")]
}
