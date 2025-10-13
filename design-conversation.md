## [timeline-ux-mode]
Support plain chat history before threads exist and allow collapsing back to a single timeline after columns fade.
> Suggested syntax extensions: permit plain transcript up front, then mark branch entry/exit with headings or delimiter cues so the parser tracks context.
> UX ideas: provide Timeline vs Board modes with a toggle, show branching markers along the linear view, let closed threads taper into chips or a resolved shelf, and maintain narrative breadcrumbs when threads rejoin.

## [terminal-chat-mode]
Desire a terminal-style flow where multiple topics can be pursued concurrently—like chatting in separate shells while waiting on other AI responses.
> Plan to keep the Markdown format compatible so each thread represents a topic, enabling quick context swaps without waiting on a single stream.

## [request-tracker]
- ✅ Added inline help/guide modal accessible from the Guide button in the header.
- ✅ Supported Codex CLI transcript parsing (▌ for prompts, `>` for AI) with confirmation on import.
- ✅ Exposed slider to resize thread columns and persisted preference.
- ✅ Hardened HTML export with marked fallback and success toast.
- 🔜 Explore timeline/board hybrid mode for collapsing threads back into a single chat.
- 🔜 Support multiple files/windows within a single Threadboard session.
