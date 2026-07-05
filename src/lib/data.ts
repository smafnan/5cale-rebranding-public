// 5CALE brand data: the FIVE ACTS system.
// NOTE: PROJECTS are styled placeholders. Swap in real case studies.

export type ActTheme = { bg: string; ink: string; accent: string };

export const THEMES: Record<string, ActTheme> = {
  base: { bg: "#0b0b0b", ink: "#f4f1ea", accent: "#d9ff3d" },
  seed: { bg: "#f2eee3", ink: "#14120d", accent: "#1f53ff" },
  build: { bg: "#1626b8", ink: "#eaedff", accent: "#71f6ff" },
  brand: { bg: "#ff4d1c", ink: "#170d08", accent: "#ffe9de" },
  grow: { bg: "#0d3b2e", ink: "#eaf6ee", accent: "#5bf1a6" },
  scale: { bg: "#0b0b0b", ink: "#f4f1ea", accent: "#a98bff" },
};

export type Act = {
  index: number;
  num: string;
  key: string;
  title: string;
  kicker: string;
  copy: string;
  chips: string[];
};

export const ACTS: Act[] = [
  {
    index: 1,
    num: "01",
    key: "seed",
    title: "SEED",
    kicker: "Every giant starts as a sketch.",
    copy: "Strategy, research and product thinking. We find the sharpest version of your idea, then draw the map from here to inevitable.",
    chips: ["Strategy", "Research", "Product thinking", "Innovation"],
  },
  {
    index: 2,
    num: "02",
    key: "build",
    title: "BUILD",
    kicker: "Blueprints become products.",
    copy: "High-performance websites, mobile apps and Shopify stores, engineered to feel expensive and load instantly.",
    chips: ["Websites", "Mobile apps", "Shopify", "E-commerce"],
  },
  {
    index: 3,
    num: "03",
    key: "brand",
    title: "BRAND",
    kicker: "A face people can't forget.",
    copy: "Identity, voice and content that make you look like the category leader before you are one.",
    chips: ["Branding", "Content creation", "Art direction", "Copywriting"],
  },
  {
    index: 4,
    num: "04",
    key: "grow",
    title: "GROW",
    kicker: "Now make it loud.",
    copy: "Marketing, social and search working as one strategy. Attention in. Customers out.",
    chips: ["Marketing", "Social media", "SEO", "Campaigns"],
  },
  {
    index: 5,
    num: "05",
    key: "scale",
    title: "SCALE",
    kicker: "Intelligence, integrated.",
    copy: "AI woven into your product and your pipeline: the part of your team that never sleeps.",
    chips: ["AI integration", "Automation", "Personalisation", "R&D"],
  },
];

export type Service = {
  title: string;
  act: string;
  blurb: string;
  deliverables: string[];
};

export const SERVICES: Service[] = [
  {
    title: "Website creation",
    act: "BUILD",
    blurb: "Custom sites that feel expensive, load instantly and convert. Design and engineering under one roof.",
    deliverables: ["UX & UI design", "Next.js / modern stack", "CMS setup", "Performance budget"],
  },
  {
    title: "Mobile apps",
    act: "BUILD",
    blurb: "iOS and Android products people keep on their home screen, from prototype to store release.",
    deliverables: ["Product design", "Cross-platform builds", "App store launch", "Analytics"],
  },
  {
    title: "Shopify development",
    act: "BUILD",
    blurb: "Storefronts tuned for speed and sales. Custom themes, apps and checkout flows that print.",
    deliverables: ["Custom themes", "App integrations", "Checkout optimisation", "Migration"],
  },
  {
    title: "Branding",
    act: "BRAND",
    blurb: "Name, mark, voice, system. An identity strong enough to survive a billboard and a favicon.",
    deliverables: ["Identity systems", "Logo & guidelines", "Naming & voice", "Rebrands"],
  },
  {
    title: "Content creation",
    act: "BRAND",
    blurb: "Photo, video, motion and words: a content engine that keeps your brand loud every week.",
    deliverables: ["Art direction", "Video & motion", "Copywriting", "Content systems"],
  },
  {
    title: "Marketing",
    act: "GROW",
    blurb: "Full-funnel campaigns for your site, product or brand. Strategy first, spend second.",
    deliverables: ["Campaign strategy", "Paid media", "Email & CRM", "Reporting"],
  },
  {
    title: "Social media management",
    act: "GROW",
    blurb: "Feeds run like products: planned, produced, published, measured. Community included.",
    deliverables: ["Channel strategy", "Content calendar", "Community", "Growth loops"],
  },
  {
    title: "Search engine optimisation",
    act: "GROW",
    blurb: "Technical, content and authority. Compounding rankings instead of rented attention.",
    deliverables: ["Technical audits", "Content strategy", "Link building", "Local SEO"],
  },
  {
    title: "AI integration",
    act: "SCALE",
    blurb: "Assistants, automation and intelligence built into your website, product and workflow.",
    deliverables: ["AI features", "Chat & agents", "Workflow automation", "Model integration"],
  },
  {
    title: "Innovation & growth",
    act: "SCALE",
    blurb: "Ongoing R&D on your brand. We keep shipping the next advantage before you need it.",
    deliverables: ["Growth sprints", "Prototyping", "New channels", "Retainers"],
  },
];

export type Project = {
  title: string;
  tags: string[];
  year: string;
  from: string;
  to: string;
};

// Placeholder case studies. Replace with real work.
export const PROJECTS: Project[] = [
  { title: "Nova Habitat", tags: ["Shopify", "Brand"], year: "2026", from: "#d9ff3d", to: "#0d3b2e" },
  { title: "Trackpace", tags: ["Mobile app", "AI"], year: "2026", from: "#a98bff", to: "#1626b8" },
  { title: "Loop Coffee", tags: ["Brand", "Web"], year: "2025", from: "#ff4d1c", to: "#170d08" },
  { title: "Mellow Money", tags: ["Web", "AI"], year: "2025", from: "#71f6ff", to: "#0b0b0b" },
  { title: "Kilnhouse", tags: ["Content", "Social"], year: "2025", from: "#ffe9de", to: "#ff4d1c" },
  { title: "Portside", tags: ["SEO", "Growth"], year: "2024", from: "#5bf1a6", to: "#0b0b0b" },
];

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/work", label: "Work" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Placeholder. Swap to the real inbox before launch.
export const CONTACT_EMAIL = "hello@5cale.com";
