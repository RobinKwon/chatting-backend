"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";

class UserStorage {
  static async getUserInfo(id) {
    try {
      const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [id]);
      return rows[0];
    } catch (err) {
      throw new Error(err);
    }
  }

  static async save(userInfo) {
    let personid;
    try {
      const birthDate = new Date(userInfo.birth).toISOString().slice(0, 10);
      const selectSessionQuery = `SELECT person_id FROM persons WHERE name = ? AND date_of_birth = ?;`;
      let [rows] = await db.execute(selectSessionQuery, [userInfo.name, birthDate]);
      if (rows.length > 0) {
        personid = rows[0].person_id;
      } else {
          const insertSessionQuery = `insert into persons(name, date_of_birth, gender, 
            occupation, health_info, blood_type, nbti, favorite_color, season, personality, 
            face_photo_url, email, phone_number, nationality, address, hometown, biography, status  )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
          await db.execute(insertSessionQuery, [userInfo.name, birthDate
            , null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]);

          [rows] = await db.execute(selectSessionQuery, [userInfo.name, birthDate]);
          if (rows.length > 0) {
            personid = rows[0].person_id;
          }
          else {
            console.error("Error fetching or creating persons.");
            return { success: false, error: "Failed to handle persons." };
        }
      }
    } catch (error) {
        throw new Error(error);
    }

    try {
      await db.execute(
        "INSERT INTO users(id, name, psword, birth, person_id) VALUES(?, ?, ?, ?, ?)",
        [userInfo.id, userInfo.name, userInfo.password, userInfo.birth, personid]
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

export default UserStorage;
