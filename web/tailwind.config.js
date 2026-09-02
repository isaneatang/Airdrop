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
          950: "#020805",
          900: "#06110b", // black-green page ground
          850: "#0a1b12", // green-black card surface
          800: "#10291a", // raised / hover
          700: "#17452b", // green hairline
          600: "#21683b", // bright green border
          500: "#4e8a61", // disabled text
          400: "#7ab18a", // tertiary text
          300: "#a8d6b2", // secondary text
          200: "#d0f1d5", // body text
          100: "#e1f9e4", // emphasis
          50: "#f1fff3", // lightest surface
        },
        // The single accent. Desaturated green, three steps only.
        moss: {
          700: "#087a3d",
          600: "#0ca650",
          500: "#35d875", // primary accent
          400: "#69f19a",
          300: "#a0ffc0",
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
