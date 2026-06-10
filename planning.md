## Music Playlist Explorer — Planning Spec

### Data Shape

All the data lives in one file: data.json. It holds two lists, one for playlists and one for songs. A playlist just points to its songs by their id, so each song is written down once and can be used in more than one playlist.

**Playlist:**

- **id**: a tag that names the playlist, like "p1".
- **name**: the title shown on screen, like "K-Rnb".
- **author**: who made the playlist.
- **coverImage**: where the playlist's cover picture lives.
- **likeCount**: how many likes the playlist has.
- **dateAdded**: the day the playlist was added. Used when sorting by date.
- **songs**: the list of songs in the playlist, in order.

**Song:**

- **id**: a tag that names the song, like "s1".
- **title**: the name of the song.
- **artist**: who performs it.
- **coverImage**: where the song's cover picture lives.
- **duration**: how long the song is, like "3:45".

### UI and Interaction Rules

**What are the main sections of the homepage?**
A grid of all the playlists, a carousel of the songs, a music player at the bottom, a side bar on the left (home, playlists, liked songs, logout), and a top bar (search, home, profile picture, and the window buttons).

**What happens when a user clicks a playlist card?**
A popup opens that shows the playlist details and all the songs inside it.

**What happens when a user clicks outside the popup?**
The popup closes.

**What happens when a user clicks the like button?**
The heart fills in red or goes back to empty, with a little animation each way.

**What does the shuffle button do?**
It mixes up the order the songs play in.

### Function Specs

**Show the playlist cards** — Milestone 3

- Takes in: the list of playlists.
- Does: makes a card for each playlist and puts them in the grid.
- Shows on each card: the cover, name, author, and like count. Clicking a card opens its popup.

**Pick which playlists to show** — Milestone 3 (search and sort)

- Takes in: nothing; it just looks at the current search text and the chosen sort.
- Does: gives back the playlists that match the search (by name or author, ignoring upper and lower case), in the chosen order: by name A to Z, by most likes, or by newest first.

**Draw the playlist grid** — Milestone 3

- Takes in: nothing.
- Does: shows the matching, sorted cards. If nothing matches the search, it shows a short "No playlists match" message instead.

**Open the playlist popup** — Milestone 4

- Takes in: one playlist.
- Does: fills the popup with the cover, title, and song count, lists the songs, sets up the shuffle and "Get Description" buttons, and shows the popup.

**Like or unlike** — Milestone 5

- Takes in: whether it's a song or a playlist, and which one.
- Does: flips the like on or off, adds or removes one from the like count, and updates every heart for that same item so they all match, with the animation.

**Shuffle the song list** — Milestone 6

- Takes in: the song list and its songs.
- Does: mixes up the song order and redraws the list so it plays in the new order.

**Show the featured playlist** — Milestone 7

- Takes in: one playlist, picked at random when the page loads.
- Does: builds the featured area, with the cover and the "Get Description" button on the left and the song list on the right.

**Get a playlist description** — Milestone 8

- See the AI Feature Spec below.

### AI Feature Spec (Milestone 8)

**Role:** Act like a music expert who reviews playlists.

**Task:** Write a short, fun description of a playlist based on its name and the songs in it.

**Inputs:** The playlist's name, its author, and the list of songs (title and artist for each one).

**Output:** Two or three sentences that capture the mood and style of the playlist.

**Avoid:** Don't list the songs one by one. Describe the overall feel instead. Keep it plain text with no special formatting.

**If it fails:** If the request doesn't work, whether the internet is down, it takes too long, or nothing comes back, don't break the page. Just show this message: "Oops! The music critic is taking a coffee break. We couldn't generate a description right now, but this playlist is still a vibe."

**How "Get a playlist description" works:**

- Takes in: one playlist.
- Gives back: the written description. If something goes wrong, it stops and lets the page show the backup message instead.
- How it asks: it sends the playlist's name, author, and song list to an outside AI service, along with a note telling the AI to act like a music expert and keep it to two or three plain sentences. The key for the service is kept in a separate file that isn't shared publicly.
- If it fails: it notes the error and shows the backup message right away, then turns the button back on.

### Decisions Log

**Milestone 0 — Project Setup**
Named the app "Waver" and went with a clean, dark look, designing around Apple's style with simple system fonts, rounded corners, soft shadows, and smooth, springy animations. Picked the main colors up front: near black background, slightly lighter gray panels, a bright blue for highlights, and a light cyan accent.

**Milestone 1 — Adding Structure with HTML**
Laid the page out so the whole thing doesn't scroll. Only the middle area does. The side bar stays on the left, the main area scrolls in the middle, and the music player stays fixed at the bottom. Set up the icons once and reused them everywhere. Left some spots empty in the HTML on purpose, to be filled in later with JavaScript.

**Milestone 2 — Styling with CSS**
Kept all the colors, spacing, rounded corners, shadows, and timings in one place so everything stays consistent. Gave the top bar and the popup a frosted glass look, added soft shadows for depth, and made cards and buttons grow a touch when hovered. Also turned off animations for people who prefer less motion.

**Milestone 3 — Displaying Shared Playlists**
Decided to keep playlists and songs in one data file, with each song saved once and shared between playlists. The grid is built from that data. Later added search and sort here: dropped the old category buttons, added a search box that filters by name or author (it runs when you hit Enter or click Search, and there's a Clear button), and a sort menu with name A to Z, most likes, and newest first. Added a date field to each playlist so the date sort works, plus a short message for when nothing matches.

**Milestone 4 — Viewing Playlist Details**
Clicking a playlist, whether from a card, the side bar, or the featured cover, opens a popup in the middle of the screen with the rest dimmed behind it. It shows the cover, title, who made it, the song count, and the full song list. It closes when you click outside it, hit the X, or press Escape. Used the same song row design in both the popup and the featured area so they look the same.

**Milestone 5 — Liking Playlists**
Built one shared system for likes so every heart for the same song or playlist stays in sync. The card, the featured area, the song row, and the bottom player all update together, and the count updates everywhere. Liking plays a little pop, unliking plays a small bounce. Since there's no server, likes reset when you reload.

**Milestone 6 — Shuffling Songs**
Shuffle mixes up the song order and redraws the list so it plays in that new order. In the bottom player, the shuffle and repeat buttons just switch on and off. In the popup, the shuffle button also shows when it's on.

**Milestone 7 — Create a Featured Page**
Added a featured playlist area showing one random playlist: the cover on the left and the song list on the right, with a thin line between them. Also built a carousel of up to ten random songs, where the middle one is biggest and the side ones are smaller and faded. It moves on its own, pauses when you hover over it, and clicking a song plays it.

**Milestone 8 — AI-Powered Playlist Descriptions**
Added a "Get Description" button in both the featured area (under the cover) and the popup (bottom left, with the shuffle button moved up next to the X). It asks an outside AI service to write a fresh description each time you click. While it's working, it shows a "Generating description" animation; when it's ready, the text types itself out letter by letter; if it fails, it shows the backup message right away. The text box in the featured area is sized to match the cover and scrolls on its own, so it never pushes the song list around.
