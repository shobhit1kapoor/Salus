import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Salus", short_name: "Salus", description: "Protected health intelligence for patients and authorized caregivers", start_url: "/", display: "standalone", background_color: "#f4f6f7", theme_color: "#0c5f5b", icons: [] };
}
