"use strict";

import db from "../config/db.js";
import { v4 as uuidv4 } from "uuid"; // UUID 생성 라이브러리 추가

class UserStorage {
  static async getUserInfo(id) {
    try {
      const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [id]); // ✅ `await`과 `execute()` 사용
      return rows[0];
    } catch (err) {
      throw new Error(err);
    }
  }

  static async save(userInfo) {
    try {
      await db.execute(
        "INSERT INTO users(id, name, psword, birth) VALUES(?, ?, ?, ?)",
        [userInfo.id, userInfo.name, userInfo.password, userInfo.birth]
      );
      return { success: true };
    } catch (err) {
      throw new Error(err);
    }
  }

  static async newsession(userInfo) {
    try {
      await db.execute(
        "INSERT INTO chat_sessions (conversation_id, user_id, model_name) VALUES(?, ?, ?)",
        [uuidv4(), userInfo.id, "gpt-4o-mini"]
      );
      return { success: true };
    } catch (err) {
      throw new Error(err);
    }
  }

  static async savemessage(userInfo) {
    try {
      await db.execute(
        "INSERT INTO chat_messages (conversation_id, user_id, question_or_answer, message) VALUES(?, ?, ?, ?)",
        [userInfo.conversation_id, userInfo.id, userInfo.q_a, userInfo.message]
      );
      return { success: true };
    } catch (err) {
      throw new Error(err);
    }
  }

  static async search_uid(userInfo) {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY date_time ASC",
        [userInfo.id]
      );
      return rows;
    } catch (err) {
      throw new Error(err);
    }
  }

  static async search_cid(userInfo) {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY date_time ASC",
        [userInfo.conversation_id]
      );
      return rows;
    } catch (err) {
      throw new Error(err);
    }
  }
}

export default UserStorage; // ✅ ESM 방식으로 export
