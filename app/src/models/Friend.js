"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";
import OpenAI from "openai";
import AnalyzeMsg from "./AnalyzeMsg.js";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class Friend {
    constructor(body) {
        this.body = body;
    }

    // POST method route
    async childhoodfriend() {
        const client = this.body;
        // It is important to keep copies of the original message arrays
        // because the while loop below consumes them.
        //const userMessagesCopy = [...client.userMessages];
        //const assistantMessagesCopy = [...client.assistantMessages];

        //console.log("CHF client:", client);

        // ---------------------------------------------
        // 1. Check if a chat session exists for today
        // ---------------------------------------------
        // We want to find a chat session for this user where the session’s created_at date is today.
        // For example, we use MySQL’s DATE() function together with CURDATE().
        let conversation_id;
        let username;
        let personid;
        try {
            // Get today’s date in the MySQL date format (YYYY-MM-DD)
            //const today = new Date().toISOString().split('T')[0];
            const today = new Date().toLocaleDateString('ko-KR', {
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
            }).replace(/\. /g, '-').replace('.', ''); // 2025. 02. 09 → 2025-02-09 변환

            const selectUserNameQuery = `SELECT name FROM users WHERE id = ?;`;
            const [usernameResult] = await db.execute(selectUserNameQuery, [client.id]);
            username = usernameResult.length > 0 ? usernameResult[0].name : "무명";

            const selectPersonIdQuery = `SELECT person_id FROM users WHERE id = ?;`;
            const [personidResult] = await db.execute(selectPersonIdQuery, [client.id]);
            personid = personidResult.length > 0 ? personidResult[0].person_id : 5;

            const selectSessionQuery = `SELECT conversation_id FROM chat_sessions WHERE user_id = ? AND DATE(created_at) = ?;`;
            const [rows] = await db.execute(selectSessionQuery, [client.id, today]);
            if (rows.length > 0) {
                conversation_id = rows[0].conversation_id;
            } else {
                conversation_id = uuidv4();
                const insertSessionQuery = `INSERT INTO chat_sessions (conversation_id, user_id, model_name) VALUES (?, ?, ?);`;
                await db.query(insertSessionQuery, [conversation_id, client.id, 'gpt-4o-mini']);
            }
        } catch (error) {
            console.error("Error fetching or creating chat session:", error);
            return { success: false, error: "Failed to handle chat session." };
        }

        let todayDateTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        // ---------------------------------------------
        // 2. Build the messages array for OpenAI API call
        // ---------------------------------------------
        let messages = [
            { role: "system", content: "너는 나의 든든한 조력자로, 친구처럼 편하게 대화할 수 있는 AI야. 나는 궁금한 점을 물어보고, 고민이 있을 때 조언을 받을 거야. 때때로 가벼운 일상 대화도 나누고 싶어. 대답할 때는 너무 딱딱하지 않게 자연스럽고 친근한 말투를 사용해 줘. 하지만 중요한 정보나 조언을 줄 때는 명확하고 신뢰할 수 있도록 설명해 줘. 나는 논리적이고 실용적인 해결책을 원하지만, 때로는 감정적인 위로도 필요할 수 있어. 내가 요청하면 유머도 적절히 섞어줘. 불확실한 정보는 정확히 모른다고 말해주고, 가짜 정보를 만들어내지 마. 내가 원하지 않는 주제는 깊게 다루지 않아도 돼." },
            { role: "user", content: `내 이름은 ${username}입니다.` },
            { role: "user", content: `저의 생년월일과 태어난 시간은 ${client.myDateTime}입니다.` },
            { role: "user", content: `오늘은 ${todayDateTime}입니다.` },
        ];

        // Fetch existing messages from the database
        try {
            const selectMessagesQuery = `SELECT q_a, message FROM chat_messages WHERE conversation_id = ?;`;
            const [existingMessages] = await db.execute(selectMessagesQuery, [conversation_id]);

            existingMessages.forEach(msg => {
                messages.push({
                    role: msg.q_a === 'question' ? 'user' : 'assistant',
                    content: msg.message.replace(/\n/g, "")
                });
            });
        } catch (error) {
            console.error("Error fetching existing messages from DB:", error);
            return { success: false, error: "Failed to fetch existing messages." };
        }

        // Append any additional messages from the request.
        if (client.userMessages.length != 0) {
            messages.push({
                role: "user",
                content: String(client.userMessages).replace(/\n/g, "")
            })
        }

        // ---------------------------------------------
        // 3. Call the OpenAI API with retries
        // ---------------------------------------------
        const maxRetries = 3;
        let retries = 0;
        let completion;
        while (retries < maxRetries) {
            try {
                completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: messages
                });
                break; // successfully got a response; exit loop
            } catch (error) {
                console.error("OpenAI API Error:", error.response ? error.response.data : error.message);
                return { success: false, error: "Failed to fetch data from OpenAI API." };
            }
        }

        let fortune = (completion.choices[0].message.content) || "No response from AI.";
        const cleanedFortune = (fortune || "No response from AI.").replace(/\r?\n/g, ' ');

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        let msg;
        try {
            // Save each user message as a 'question'
            if (client.userMessages.length >= 1) {
                msg = client.userMessages.replace(/\r?\n/g, ' ');
                const insertUserMsgQuery = `
                    INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                    VALUES (?, ?, ?, ?);
                `;
                await db.query(insertUserMsgQuery, [conversation_id, client.id, 'question', msg]);
            }

            // Save assistant message as an 'answer'
            const insertAssistMsgQuery = `
                INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                VALUES (?, ?, ?, ?);
            `;
            await db.query(insertAssistMsgQuery, [conversation_id, client.id, 'answer', cleanedFortune]);
        } catch (error) {
            console.error("Error saving chat messages to DB:", error);
            return { success: false, error: "Failed to save chat messages." };
        }

        // ---------------------------------------------
        // 5. Analyzing conversation message.
        // ---------------------------------------------
        //console.log("person id:", personid);
        //console.log("message:", msg);
        const analyzer = new AnalyzeMsg(msg);
        await analyzer.extractFieldsFromConversation(personid, msg);

        //res.json({"assistant": fortune});
        return { success: true, assistant: fortune };
    };
}

export default Friend;