# Demo and viva notes

Start with U0001. Ask what to play next. Open View source, correct the artist, then run the same question again. End with U0003 and its saved podcast position.

| Sawaal | Apne words mein answer |
| --- | --- |
| 664 rows se 661 events kaise aaye? | Teen deliveries mein same listener aur idempotency key repeat hui. Event ID alag tha, isliye sirf event ID ke basis par duplicate miss ho jata. |
| 88% ka denominator kya hai? | 300 listeners mein 264 ke exactly do unique actions hain. 264 divided by 300 equals 88%. |
| Episode aur preference ka difference? | Ek gaana play hua, ye episode hai. Listener ne bola Arijit ko yaad rakho, ye explicit preference hai. Ek play se permanent taste assume karna galat ho sakta hai. |
| Graph aur vector dono kyun? | Graph singer ko track ya podcast se jodta hai. TF–IDF words ko numerical weights deta hai. Cosine similarity se query aur memory compare hoti hain. |
| Correction ka proof? | Same request pehle aur baad mein run karo. Purani edge superseded dikhni chahiye. Nayi preference reply mein use honi chahiye. |
| Podcast 7:00 se kyun shuru hua? | U0003 ke unfinished episode ki saved position 420 seconds thi. 420 divided by 60 equals 7 minutes. Completed episode resume list se bahar tha. |
| 0.95 confidence ka kya matlab hai? | Explicit statement ko rule se high score mila. Isse 95% real-world accuracy ka claim nahi kar sakte. |
| Precision perfect kaise thi? | Is chhote synthetic golden set ke 43 returned candidates expected the. Real listeners ke outcomes alag se measure karne honge. |
| P95 kya hai? | Lagbhag 95% measured requests is time ke andar finish hui. EDA mein event delivery delay aur benchmark mein retrieval response time do alag cheezein hain. |
| LLM kahan hai? | Default demo catalog rules use karti hai. Local Ollama connect karne par model ko approved context aur choices milte hain. Backend output validate karta hai. |
