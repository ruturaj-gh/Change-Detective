/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          page: "#0a0a0a",
          sidebar: "#111111",
          card: "#161616",
          "card-hover": "#1e1e1e",
        },
        accent: {
          DEFAULT: "#22c55e",
          dim: "#16a34a",
          muted: "#14532d",
        },
        border: "#2a2a2a",
        warning: "#f59e0b",
        danger: "#ef4444",
        delta: {
          positive: "#22c55e",
          negative: "#f97316",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

