# Without a connection

A save that gets no answer within 15 seconds, or that meets a server or proxy
failure, or a lapsed sign-in, waits on the phone instead of failing: the session
or meal is shown as saved, marked as waiting in the Log and counted beside the
refresh button, and sent by itself when the app comes back into view, when the
phone comes back online, every minute while anything waits, and the next time the
app opens. Records carry ids made on the phone and the server upserts on them, so
sending one twice is harmless. A delete waits the same way. One the server turns
down for good is set aside, marked with the reason, for an edit or a delete. What
waits is kept in browser storage; a phone that refuses storage keeps it until the
app closes. The whole-journal figures catch up once it is sent.

The app also opens with no connection, once it has been opened with one: a
service worker (`public/sw.js`) keeps the last copy of the journal page and the
built files it needs, and serves them only when the network does not answer. Each
deploy brings a new worker and drops the old copy. Signing out deletes the copy;
anything still waiting stays, and sends after the next sign-in.

Coming back to the app fetches what the other phone logged, at most every 30
seconds. While Setup holds unsaved typing, the settings are left alone and only the
entries are fetched.
