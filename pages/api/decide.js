import { decide } from "../../lib/engine";
import { DEFAULT_CONFIG } from "../../lib/defaults";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  try {
    const { applicant, config } = req.body || {};
    if (!applicant) return res.status(400).json({ error: "Missing applicant" });
    const result = decide(applicant, config || DEFAULT_CONFIG);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: "Engine error", detail: String(e) });
  }
}
