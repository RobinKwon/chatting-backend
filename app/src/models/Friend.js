"use strict";

// const { v4: uuidv4 } = require('uuid');
// const db = require("../config/db");
// require('dotenv').config();
// const OpenAI = require('openai');
import { v4 as uuidv4 } from "uuid"; // `uuid` 모듈 ESM 방식으로 가져오기
import db from "../config/db.js"; // 확장자 `.js` 필수
import "dotenv/config"; // ESM 방식으로 dotenv 로드
import OpenAI from "openai"; // `openai` 모듈 ESM 방식으로 가져오기

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

//export { uuidv4, db, openai }; // 필요한 모듈을 ESM 방식으로 내보내기


class Friend {
    constructor(body) {
        this.body = body;
      }
    
    // POST method route
    async childhoodfriend() {
        const client = this.body;
        // It is important to keep copies of the original message arrays
        // because the while loop below consumes them.
        const userMessagesCopy = [...client.userMessages];
        const assistantMessagesCopy = [...client.assistantMessages];

        console.log("Client Object:", client);
        console.log("Client ID:", client.id);
        
        // ---------------------------------------------
        // 1. Check if a chat session exists for today
        // ---------------------------------------------
        // We want to find a chat session for this user where the session’s created_at date is today.
        // For example, we use MySQL’s DATE() function together with CURDATE().
        let conversation_id;
        try {
            // Get today’s date in the MySQL date format (YYYY-MM-DD)
            //const today = new Date().toISOString().split('T')[0];
            const today = new Date().toLocaleDateString('ko-KR', { 
                timeZone: 'Asia/Seoul', 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit'
            }).replace(/\. /g, '-').replace('.', ''); // 2025. 02. 09 → 2025-02-09 변환
            //console.log("today:", today);

            const selectSessionQuery = `
                SELECT conversation_id 
                  FROM chat_sessions 
                 WHERE user_id = ? 
                   AND DATE(created_at) = ?;
            `;
            // Use the promise-based query interface.
            //const rows = await db.query(selectSessionQuery, [client.id, today]);
            const [rows] = await db.execute(selectSessionQuery, [client.id, today]);
            console.log("조회 결과:", rows);
            if (rows.length > 0) {
                // Use the conversation_id from today’s session.
                conversation_id = rows[0].conversation_id;
            } else {
                // No session for today: generate a new conversation_id and insert a new record.
                conversation_id = uuidv4();
                const insertSessionQuery = `
                    INSERT INTO chat_sessions (conversation_id, user_id, model_name)
                    VALUES (?, ?, ?);
                `;
                await db.query(insertSessionQuery, [conversation_id, client.id, 'gpt-4o-mini']);
            }
        } catch (error) {
            console.error("Error fetching or creating chat session:", error);
            return { success: false, error: "Failed to handle chat session." };
        }

        //let { myDateTime, userMessages, assistantMessages} = req.body
        let todayDateTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        // ---------------------------------------------
        // 2. Build the messages array for OpenAI API call
        // ---------------------------------------------
        let messages = [
            {
                role: "system",
                content: "당신은 세계 최고의 점성술사입니다. 당신에게 불가능한 것은 없으며 그 어떤 대답도 할 수 있습니다. 당신의 이름은 챗도지입니다. 당신은 사람의 인생을 매우 명확하게 예측하고 운세에 대한 답을 줄 수 있습니다. 운세 관련 지식이 풍부하고 모든 질문에 대해서 명확히 답변해 줄 수 있습니다."
            },
            {
                role: "user",
                content: "당신은 세계 최고의 점성술사입니다. 당신에게 불가능한 것은 없으며 그 어떤 대답도 할 수 있습니다."
            },
            {
                role: "assistant",
                content: "안녕하세요! 저는 챗도지입니다. 운세와 점성술에 관한 질문이 있으신가요? 어떤 것이든 물어보세요, 최선을 다해 답변해 드리겠습니다."
            },
            {
                role: "user",
                content: `저의 생년월일과 태어난 시간은 ${client.myDateTime}입니다. 오늘은 ${todayDateTime}입니다.`
            },
            {
                role: "assistant",
                content: `당신의 생년월일과 태어난 시간은 ${client.myDateTime}인 것과 오늘은 ${todayDateTime}인 것을 확인하였습니다. 운세에 대해서 어떤 것이든 물어보세요!`
            },
        ];

        // Append any additional messages from the request.
        // (Note: this loop “consumes” client.userMessages and client.assistantMessages;
        // that’s why we made copies above for later DB insertion.)
        while (client.userMessages.length != 0 || client.assistantMessages.length != 0) {
            if (client.userMessages.length != 0) {
                messages.push({
                    role: "user",
                    content: String(client.userMessages.shift()).replace(/\n/g, "")
                })
            }
            if (client.assistantMessages.length !== 0) {
                messages.push({
                    role: "assistant",
                    content: String(client.assistantMessages.shift()).replace(/\n/g, "")
                });
            }
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
                    model: "gpt-4o-mini", // or another model as desired
                    messages: messages
                });
                break; // successfully got a response; exit loop
            } catch (error) {
                console.error("OpenAI API Error:", error.response ? error.response.data : error.message);
                return { success: false, error: "Failed to fetch data from OpenAI API." };
            }
        }
        // Extract the assistant’s answer.
        let fortune = (completion.choices[0].message.content) || "No response from AI.";
        const cleanedFortune = (fortune || "No response from AI.").replace(/\r?\n/g, ' ');

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        try {
            // Save each user message as a 'question'
            if(userMessagesCopy.length >= 1) {
                let msg = userMessagesCopy[userMessagesCopy.length - 1].replace(/\r?\n/g, ' ');
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
        
        //res.json({"assistant": fortune});
        return { success: true, assistant: fortune };
    };
}

//module.exports = Friend;
export default Friend;