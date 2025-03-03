"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";
import OpenAI from "openai";

const openai = new OpenAI({
     apiKey: process.env.OPENAI_API_KEY,
});

class AnalyzeMsg {
    constructor(body) {
        this.body = body;
    }

    /**
     * 대화 내용을 분석하여 persons 테이블의 필드와 값을 JSON 형태로 추출
     * @param {string} conversationText 대화 내용
     * @returns {object} { 필드명: 값, ... } 형태의 JSON 객체
     */
    async extractFieldsFromConversation(person_id, conversationText) {
        // 2. 메시지 구성
        const messages = [
            {
                // "system" 역할의 메시지에 전체 컨텍스트와 규칙, 테이블 스키마를 설명
                role: 'system',
                content: `
                당신은 대화 내용을 분석하여, "persons" 테이블과 관련된 필드에 해당하는 값이 있는지 찾아 JSON으로 반환하는 역할을 합니다.
                테이블 스키마는 다음과 같습니다:

                - person_id (int)
                - name (varchar(100))
                - date_of_birth (date)
                - gender (enum('male','female','other'))
                - occupation (varchar(100))
                - health_info (text)
                - blood_type (varchar(50))
                - nbti (varchar(50))
                - favorite_color (varchar(50))
                - season (varchar(50))
                - personality (varchar(50))
                - face_photo_url (varchar(255))
                - email (varchar(100))
                - phone_number (varchar(20))
                - nationality (varchar(50))
                - address (varchar(255))
                - hometown (varchar(255))
                - biography (text)
                - status (enum('active','inactive'))
                - created_at (datetime)
                - updated_at (datetime)

                다음 조건을 따르세요:
                1. 대화 내용 중 위 테이블 필드와 관련된 언급을 유연하게 인식합니다. (예를 들어, "내 이름은", "생일은", "주소는" 등 다양한 표현을 포함)
                2. 필드명이 정확히 언급되지 않더라도 맥락에 맞게 해당 필드를 추정할 수 있다면 추출합니다.
                3. 추출 결과는 반드시 JSON 객체 형태로만 출력합니다. 예: {"name": "홍길동", "gender": "male"}.
                4. 입력 대화에서 식별된 필드만 포함하고, 해당되지 않는 필드는 제외합니다.
                5. 만약 어떤 필드도 식별되지 않으면 반드시 오직 {}을 반환합니다.
                `
            },
            {
                // "user" 역할의 메시지에 실제 대화 내용 전달
                role: 'user',
                content: `다음 대화를 분석해주세요:\n\n${conversationText}`
            },
        ];
        // 다음 조건을 반드시 지키세요:
        //1. 위 테이블에 존재하지 않는 필드는 무시합니다.
        // 2. 대화에서 해당 필드와 유사한 언급이 있으면, "필드명: 값" 형태로 추출합니다.
        // 3. JSON 객체 형태로만 결과를 출력합니다. 예: {"name":"홍길동","gender":"male"}
        // 5. 아무것도 찾을 수 없으면 {"error":"홍길동"}를 반환합니다.
        //4. 해당되지 않는 필드는 포함하지 않습니다.
        //5. 빈 객체 {}
        //5. 만약 어떤 필드도 식별되지 않으면 빈 JSON 객체 {}를 반환합니다.

        console.log("person id:", person_id);
        console.log("message:", conversationText);
        // 3. ChatGPT API 호출 (gpt-3.5-turbo 또는 gpt-4 등 모델 지정)
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            //temperature: 5, // 필요에 따라 조정
        });

        // 응답 검증
        console.log("response:", response.choices[0].message);
        if (!Array.isArray(response.choices) || response.choices.length === 0) {
            console.log("API 응답에 choices 배열이 없거나 비어 있습니다."); //throw new Error
            return;
        }

        // 4. 결과 파싱
        const assistantMessage = response.choices[0].message?.content?.trim() || '';

        // JSON 파싱 시도
        let jsonResult;
        try {
            jsonResult = JSON.parse(assistantMessage);
        } catch (error) {
            console.error('JSON 파싱 에러:', error);
            // 파싱 실패 시 빈 객체로 처리
            jsonResult = {};
        }

        // 만약 아무런 필드도 추출되지 않았다면, 업데이트 중단
        if (Object.keys(jsonResult).length === 0) {
            console.log("추출된 필드가 없어 persons 테이블 업데이트를 진행하지 않습니다.");
            return;
        }

        // 전달받은 person_id를 사용하여 업데이트할 필드만 jsonResult에서 사용
        const updateFields = jsonResult;


        // 업데이트할 필드가 실제로 있는지 확인
        const columns = [];
        const values = [];
        for (const [key, value] of Object.entries(updateFields)) {
            // 혹시나 value가 undefined/null 등인 경우 필터링할 수 있음
            columns.push(`${key} = ?`);
            values.push(value);
        }

        if (columns.length === 0) {
            console.log("업데이트 가능한 필드가 없어 persons 테이블 업데이트를 진행하지 않습니다.");
            return;
        }

        // DB 업데이트 쿼리 구성
        const sql = `UPDATE persons SET ${columns.join(", ")} WHERE person_id = ?`;
        values.push(person_id);

        // 4. DB 업데이트 실행
        try {
            const [result] = await db.execute(sql, values);
            console.log(`persons 테이블 업데이트 완료 (person_id=${person_id})`, result);
        } catch (err) {
            console.error("persons 테이블 업데이트 중 에러 발생:", err);
        }
        //return jsonResult;
    }
}

    // 5. 사용 예시
    // (async () => {
    //   try {
    //     const conversation = `
    //       제 이름을 김철수로 변경하고 싶어요. 생일은 1990-05-10이고,
    //       성별은 male이에요. 그리고 혈액형은 O형이구요.
    //       주소는 서울시 강남구입니다. 국적은 한국입니다.
    //     `;

    //     const extractedData = await extractFieldsFromConversation(conversation);
    //     console.log('추출된 결과:', extractedData);
    //     // 예: { "name": "김철수", "date_of_birth": "1990-05-10", "gender": "male", "blood_type": "O형", "address": "서울시 강남구", "nationality": "한국" }
    //   } catch (err) {
    //     console.error(err);
    //   }
    // })();

export default AnalyzeMsg;
