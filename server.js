
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MUSICCLOUD_API_KEY;

const API = "https://api.musiccloud.io/api/v1";

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "dev.astrogawd.bitchord.lossless",
    name: "CC Lossless",
    version: "1.0.0",
    resources: ["search", "stream"],
    allowDownloads: 0,
    settings: [
      {
        key: "quality",
        type: "select",
        default: "lossless",
        options: [
          { label: "Lossless", value: "lossless" }
        ]
      }
    ]
  });
});

async function ccResolve(body) {
  const response = await fetch(`${API}/cc/resolve`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`MusicCloud API error: ${response.status}`);
  }

  return response.json();
}

function formatTrack(track, id) {
  return {
    id,
    title: track.title,
    artist: track.artistName || "",
    album: track.albumName || "",
    duration: track.durationMs
      ? track.durationMs / 1000
      : undefined,
    artworkURL: track.artworkUrl || undefined,
    format: "flac",
    audioQuality: "LOSSLESS"
  };
}

app.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();

  if (!query) {
    return res.json({ tracks: [] });
  }

  if (!API_KEY) {
    return res.status(503).json({
      error: "MusicCloud API key is not configured"
    });
  }

  try {
    const data = await ccResolve({ query });

    if (data.status === "disambiguation") {
      const tracks = data.candidates.map(candidate => ({
        id: candidate.id,
        title: candidate.title,
        artist: (candidate.artists || []).join(", "),
        album: candidate.albumName || "",
        artworkURL: candidate.artworkUrl || undefined,
        format: "flac",
        audioQuality: "LOSSLESS"
      }));

      return res.json({ tracks });
    }

    if (data.type === "cc-track" && data.track) {
      return res.json({
        tracks: [
          formatTrack(
            data.track,
            `jamendo:${data.track.jamendoId}`
          )
        ]
      });
    }

    return res.json({ tracks: [] });

  } catch (error) {
    console.error("Search error:", error.message);
    return res.status(502).json({ tracks: [] });
  }
});

app.get("/stream/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!API_KEY) {
      return res.status(503).json({
        error: "API key not configured"
      });
    }

    const data = await ccResolve({
      selectedCandidate: id
    });

    if (data.type !== "cc-track" || !data.track?.jamendoId) {
      return res.status(404).json({
        error: "Track not found"
      });
    }

    const jamendoId = data.track.jamendoId;

    if (!/^\d+$/.test(String(jamendoId))) {
      return res.status(400).json({
        error: "Invalid track ID"
      });
    }

    res.json({
      url: `${API}/cc/audio/${jamendoId}?format=flac`,
      format: "flac",
      quality: "Lossless FLAC",
      codec: "flac",
      container: "flac",
      manifest: "none",
      encrypted: false
    });

  } catch (error) {
    console.error("Stream error:", error.message);
    res.status(502).json({
      error: "Unable to resolve audio"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CC Lossless running on port ${PORT}`);
});
