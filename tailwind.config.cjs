module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["IBM Plex Sans", "ui-sans-serif", "system-ui"]
      },
      colors: {
        ink: "#0b0f1a",
        neon: "#29f3c3",
        electric: "#6c7cff"
      },
      backgroundImage: {
        grid: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
        glow: "radial-gradient(circle at 20% 20%, rgba(41,243,195,0.15), transparent 45%)"
      }
    }
  },
  plugins: [require("@tailwindcss/typography")]
};