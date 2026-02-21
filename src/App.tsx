import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { chat, Message } from "./agent.js";

export default function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState("");

    const handleSubmit = async (value: string) => {
        if (!value.trim()) return;

        const newMessages = [...messages, { role: "user" as const, content: value }];
        setMessages(newMessages);
        setInput("");
        setLoading(true);
        setStatusText("Thinking...");

        try {
            const reply = await chat(newMessages, (status: string) => setStatusText(status));
            setMessages(prev => [...prev, { role: "assistant", content: reply }]);
        } catch (e: any) {
            setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
        } finally {
            setLoading(false);
            setStatusText("");
        }
    };

    return (
        <Box flexDirection="column" padding={1}>
            <Box flexDirection="column" marginBottom={1}>
                <Text bold color="cyan">Image Generation OpenRouter Agent</Text>
                <Text dimColor>Type 'exit' or press Ctrl+C to quit.</Text>
            </Box>

            <Box flexDirection="column" marginBottom={1}>
                {messages.map((msg, idx) => (
                    <Box key={idx} flexDirection="column" marginBottom={1}>
                        <Text color={msg.role === "user" ? "blue" : "green"} bold>
                            {msg.role === "user" ? "You:" : "Agent:"}
                        </Text>
                        <Text>{msg.content}</Text>
                    </Box>
                ))}
            </Box>

            {loading && (
                <Box marginBottom={1}>
                    <Text color="yellow">{statusText}</Text>
                </Box>
            )}

            {!loading && (
                <Box>
                    <Box marginRight={1}>
                        <Text color="blue" bold>You:</Text>
                    </Box>
                    <TextInput
                        value={input}
                        onChange={(val: string) => {
                            if (val.toLowerCase() === "exit") process.exit(0);
                            setInput(val);
                        }}
                        onSubmit={handleSubmit}
                        placeholder="Type your message..."
                    />
                </Box>
            )}
        </Box>
    );
}
