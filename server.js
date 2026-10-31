
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MUSICCLOUD_API_KEY;

const API = "https://api.musiccloud.io/api/v1";

const MANIFEST = {
  id: "dev.astrogawd.bitchord.lossless",
  name: "CC Lossless",
  version: "1.1.0",
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
};

app.get("/", (req, res) => {
  res.send("BitChord CC Lossless addon is running.");
});

app.get("/manifest.json", (req, res) => {
  res.json(MANIFEST);
});

// MusicCloud API request
async function resolveMusicCloud(body) {
  if (!API_KEY) {
    throw new Error("MusicCloud API key is missing");
  }

  const response = await fetch(`${API}/cc/resolve`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`MusicCloud returned ${response.status}`);
  }

  return response.json();
}

// Encode provider IDs before exposing them to BitChord
function encodeId(id) {
  return Buffer.from(String(id)).toString("base64url");
}

function decodeId(id) {
  return Buffer.from(id, "base64url").toString("utf8");
}

// Format a track for BitChord
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

// SEARCH
app.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();

  if (!query) {
    return res.json({ tracks: [] });
  }

  try {
    const data = await resolveMusicCloud({ query });
    let tracks = [];

    // Directly resolved Creative Commons track
    if (data.type === "cc-track" && data.track) {
      tracks.push(
        formatTrack(
          data.track,
          `jamendo:${data.track.jamendoId}`
        )
      );
    }

    // Text searches return candidate choices
    else if (Array.isArray(data.candidates)) {
      tracks = data.candidates
        .filter(item => item.id && item.title)
        .map(item => ({
          id: `mc:${encodeId(item.id)}`,
          title: item.title,
          artist: Array.isArray(item.artists)
            ? item.artists.join(", ")
            : item.artistName || "",
          album: item.albumName || "",
          duration: item.durationMs
            ? item.durationMs / 1000
            : undefined,
          artworkURL: item.artworkUrl || undefined,
          format: "flac",
          audioQuality: "LOSSLESS"
        }));
    }

    res.json({ tracks });

  } catch (error) {
    console.error("Search error:", error.message);

    res.status(502).json({
      tracks: [],
      error: "Music catalogue search failed"
    });
  }
});

// STREAM
app.get("/stream/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let jamendoId;

    // Direct Jamendo track ID
    if (id.startsWith("jamendo:")) {
      jamendoId = id.slice(8);
    }

    // Resolve an opaque MusicCloud candidate ID
    else if (id.startsWith("mc:")) {
      const candidateId = decodeId(id.slice(3));

      const data = await resolveMusicCloud({
        selectedCandidate: candidateId
      });

      if (
        data.type !== "cc-track" ||
        !data.track?.jamendoId
      ) {
        return res.status(404).json({
          error: "No playable Creative Commons track found"
        });
      }

      jamendoId = data.track.jamendoId;
    }

    else {
      return res.status(404).json({
        error: "Unknown track ID"
      });
    }

    if (!/^\d+$/.test(String(jamendoId))) {
      return res.status(400).json({
        error: "Invalid Jamendo track ID"
      });
    }

    const audioURL =
      `${API}/cc/audio/${jamendoId}?format=flac`;

    res.json({
      url: audioURL,
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
      error: "Unable to resolve audio stream"
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`BitChord addon running on port ${PORT}`);
});
