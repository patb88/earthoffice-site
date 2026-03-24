# Chat Explorer – Quick Guide

## What Is Chat Explorer?

Chat Explorer lets you load exported ChatGPT, Claude, Gemini, and Grok conversations, organize them with topics and tags, and explore them using filters and navigation tools.

Your original export is never modified. Topics, tags, and assignments are stored separately.

## Security & Privacy

All processing happens in your browser.

- No data is sent to a server
- No external APIs are called
- Your conversations never leave your device

Everything stays on your machine.

## Quick Start

1. Export conversations from your chat platform(s).
2. Load them into Explorer.
3. Optionally load existing `topics.json` and `tags.json` files.
4. Browse conversations in the left panel.
5. Click a conversation to show prompts in the middle panel and the full conversation in the right panel.
6. Click a prompt in the middle panel to jump to that prompt in the full conversation.

## Export Your Conversations

1. Each platform has a slightly different mechanism for exporting conversations.  The function is usually an option in "security" or "privacy" in the user menu.

## Load Conversations

1. Click **Choose Files**
2. Select one or multiple export JSON files
3. If you already have `topics.json` or `tags.json`, you can load them along with your conversation files
4. Conversations will appear in the left navigation panel

You can load multiple files in one session, and you can mix exports from different platforms.

## Using the Left Navigation Panel

- **Search** searches conversation content by keyword
- **Preview** controls how many characters appear in preview text
- **From / To** filters conversations by date
- **Topic** filters by topic after topics have been loaded
- **Tags** filters by tag after tags have been loaded
- **Platforms** shows or hides a platform's conversations
- **Apply** applies your current filter selections
- **Clear** resets the filter selections
- **Filter conversation titles** narrows the conversation list by title text


If conversations seem to disappear, check whether a filter is active.

## Topics & Tags

### Add Topics to a Conversation

- Topics are assigned at the conversation level
- Think of topics as broad categories or projects
- Open the Topics panel by clicking **Add/Edit Topics** in the Conversations area
- Select an existing topic, or create a new one by entering a name, clicking **Add**, and then clicking **Save**
- Topics can be renamed later

### Add Tags to a Turn

- Tags can be applied to individual turns
- A turn is a prompt and its response
- Select an existing tag, or create a new one by entering the tag text, clicking **Add**, and then clicking **Save**
- Tags help with fine-grained organization and filtering

## Export Topics & Tags

- **Export Topics** downloads your assigned topics to `topics.json`
- **Export Tags** downloads your assigned tags to `tags.json`
- Your original conversation files are never changed
- Topics and tags remain separate from the original export

## Recommended Workflow

1. Export conversations
2. Load conversations into Explorer
3. Load existing topics and tags, if you have them
4. Add or update topics
5. Add or update tags
6. Export topics and tags as backup
