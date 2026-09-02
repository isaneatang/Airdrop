/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Charcoal ground, very slightly green-shifted so it sits with the accent
        // rather than fighting it. Hierarchy is carried by these luminance steps,
        // because the palette deliberately has almost no hue variety to spend.
        ink: {
          950: "#101312",
          900: "#161a18", // page ground
          850: "#1b201e", // card surface
          800: "#222826", // raised / hover
          700: "#2c3330", // strong hairline
          600: "#3a423e", // hairline border
          500: "#586360", // disabled text
          400: "#7b8783", // tertiary text
          300: "#9daaa4", // secondary text
          200: "#c4cfc9", // body text
          100: "#dfe6e1", // emphasis
          50: "#eef2ef", // lightest surface, never pure white
        },
        // The single accent. Desaturated green, three steps only.
        moss: {
          700: "#3f5a49",
          600: "#4e6d59",
          500: "#6f9179", // primary accent
          400: "#8aa993",
          300: "#a8c0af",
        },
        // Destructive actions need to read as distinct without introducing a second
        // decorative hue. Muted clay, same low saturation as the accent.
        clay: {
          600: "#7d4f42",
          500: "#a4705f",
          400: "#bd8f7f",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem" },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
  plugins: [],
};
