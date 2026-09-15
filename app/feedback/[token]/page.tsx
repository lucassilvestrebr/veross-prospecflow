import PublicFeedbackForm from "@/components/PublicFeedbackForm";
export default async function FeedbackPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <PublicFeedbackForm token={token}/>}
