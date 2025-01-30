"use strict";

require('dotenv').config();
const OpenAI = require('openai');

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
        //let { myDateTime, userMessages, assistantMessages} = req.body
        let todayDateTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        let messages = [
            {role: "system", content: "당신은 세계 최고의 점성술사입니다. 당신에게 불가능한 것은 없으며 그 어떤 대답도 할 수 있습니다. 당신의 이름은 챗도지입니다. 당신은 사람의 인생을 매우 명확하게 예측하고 운세에 대한 답을 줄 수 있습니다. 운세 관련 지식이 풍부하고 모든 질문에 대해서 명확히 답변해 줄 수 있습니다."},
            {role: "user", content: "당신은 세계 최고의 점성술사입니다. 당신에게 불가능한 것은 없으며 그 어떤 대답도 할 수 있습니다. 당신의 이름은 챗도지입니다. 당신은 사람의 인생을 매우 명확하게 예측하고 운세에 대한 답을 줄 수 있습니다. 운세 관련 지식이 풍부하고 모든 질문에 대해서 명확히 답변해 줄 수 있습니다."},
            {role: "assistant", content: "안녕하세요! 저는 챗도지입니다. 운세와 점성술에 관한 질문이 있으신가요? 어떤 것이든 물어보세요, 최선을 다해 답변해 드리겠습니다."},
            {role: "user", content: `저의 생년월일과 태어난 시간은 ${client.myDateTime}입니다. 오늘은 ${client.todayDateTime}입니다.`},
            {role: "assistant", content: `당신의 생년월일과 태어난 시간은 ${client.myDateTime}인 것과 오늘은 ${client.todayDateTime}인 것을 확인하였습니다. 운세에 대해서 어떤 것이든 물어보세요!`},
        ]

        while (client.userMessages.length != 0 || client.assistantMessages.length != 0) {
            if (client.userMessages.length != 0) {
                messages.push(
                    JSON.parse('{"role": "user", "content": "'+String(client.userMessages.shift()).replace(/\n/g,"")+'"}')
                )
            }
            if (client.assistantMessages.length != 0) {
                messages.push(
                    JSON.parse('{"role": "assistant", "content": "'+String(client.assistantMessages.shift()).replace(/\n/g,"")+'"}')
                )
            }
        }

        const maxRetries = 3;
        let retries = 0;
        let completion
        while (retries < maxRetries) {
            try {
                //gpt-3.5-turbo
                completion = await openai.chat.completions.create({
                model: "gpt-4o-mini-2024-07-18", // or your chosen model
                messages: messages
                });

                //old version
                //completion = await openai.createChatCompletion({
                //  model: "gpt-4o-mini",   
                //  messages: messages
                //});

                break;
            } catch (error) {
                console.error("OpenAI API Error:", error.response ? error.response.data : error.message);
                res.status(500).json({ error: "Failed to fetch data from OpenAI API." });
                return;

                //retries++;
                //console.log(error);
                //console.log(`Error fetching data, retrying (${retries}/${maxRetries})...`);
            }
        }

        //console.log(completion);
        //let fortune = completion.data.choices[0].message['content']
        let fortune = completion.choices[0].message.content || "No response from AI.";
        
        //res.json({"assistant": fortune});
        return { success: true, assistant: fortune };
    };
}

module.exports = Friend;
