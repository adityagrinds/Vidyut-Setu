/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Orbitron", "sans-serif"],
        body: ["Rajdhani", "sans-serif"],
      },
      animation: {
        "spin-slow": "spin 9s linear infinite",
        radar: "radarPulse 1.4s ease-out infinite",
        "flash-red": "flashRed 0.4s ease-in-out 1",
      },
      keyframes: {
        radarPulse: {
          "0%": { transform: "scale(0.8)", opacity: "0.6" },
          "70%": { transform: "scale(1.8)", opacity: "0" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        flashRed: {
          "0%": { color: "#f8fafc" },
          "50%": { color: "#ef4444" },
          "100%": { color: "#f8fafc" },
        },
      },
      boxShadow: {
        glow: "0 0 18px rgba(251, 146, 60, 0.45)",
        cyan: "0 0 24px rgba(34, 211, 238, 0.35)",
      },
    },
  },
  plugins: [],
};
